import { BezigonEngine } from './engine.ts';
import { History } from './history.ts';
import { emptyState, makeNode } from './model.ts';
import type { EditorState, NodeType, Point } from './model.ts';
import { makeScene } from './scenes.ts';
import { visibleHandles } from './handles.ts';
import type { EditTarget } from './handles.ts';

interface Gesture {
  pointerId: number;
  kind: EditTarget['kind'];
  index: number;
  press: Point;
  potentialClose: boolean;
  moved: boolean;
  before: EditorSnapshot;
}

interface EditorSnapshot {
  state: EditorState;
  selected: EditTarget | null;
}

const distanceSq = (a: Point, b: Point): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** GUI gestures and history only. Curve and handle calculations go to WASM. */
export class Editor {
  state = emptyState();
  readonly history = new History<EditorSnapshot>();
  showHandles = true;
  pointer: Point | null = null;
  private gesture: Gesture | null = null;
  private selected: EditTarget | null = null;
  private engine: BezigonEngine;
  private changed: () => void;
  constructor(engine: BezigonEngine, changed: () => void) {
    this.engine = engine;
    this.changed = changed;
  }

  hitNode(point: Point): number {
    return this.state.nodes.findIndex((n) => distanceSq(n, point) <= 64);
  }
  hitTarget(point: Point): EditTarget | null {
    // On-curve points retain priority when a handle tip overlaps a point.
    const index = this.hitNode(point);
    if (index >= 0) return { kind: 'node', index };
    if (this.showHandles) {
      for (let i = 0; i < this.state.nodes.length; i++) {
        const handle = visibleHandles(this.state.nodes[i], i).find(
          (h) => distanceSq(h, point) <= 64,
        );
        if (handle) return { kind: handle.kind, index: i };
      }
    }
    return null;
  }
  get dragging(): boolean {
    return this.gesture !== null;
  }
  get activeTarget(): EditTarget | null {
    return this.gesture ? { kind: this.gesture.kind, index: this.gesture.index } : null;
  }
  get selectedTarget(): EditTarget | null {
    return this.selected;
  }

  private snapshot(): EditorSnapshot {
    return structuredClone({ state: this.state, selected: this.selected });
  }
  private restore(snapshot: EditorSnapshot): void {
    this.state = snapshot.state;
    this.selected = snapshot.selected;
  }
  private commit(before: EditorSnapshot): void {
    // Selection alone is view state; each drawing edit restores its selection
    // on undo/redo without adding extra undo steps for clicks between points.
    if (JSON.stringify(before.state) !== JSON.stringify(this.state)) {
      this.history.commit(before, this.snapshot());
    }
  }

  private edit(action: () => void): void {
    this.cancelGesture();
    const before = this.snapshot();
    action();
    this.commit(before);
    this.changed();
  }

  clear(): void {
    this.edit(() => {
      this.state = emptyState();
      this.selected = null;
    });
  }
  finish(): void {
    this.edit(() => {
      if (this.state.nodes.length && !this.state.close) this.state.finished = true;
    });
  }
  toggleHandles(): void {
    this.showHandles = !this.showHandles;
    if (!this.showHandles && this.selected)
      this.selected = { kind: 'node', index: this.selected.index };
    this.changed();
  }
  resetHandles(): void {
    this.edit(() => {
      this.state.nodes.forEach((n) => {
        n.manualIn = n.manualOut = false;
      });
      this.engine.run(this.state);
    });
  }
  resetSelectedHandles(): void {
    if (this.dragging || !this.selected) return;
    const index = this.selected.index;
    const node = this.state.nodes[index];
    if (!node || (!node.manualIn && !node.manualOut)) return;
    this.edit(() => {
      node.manualIn = node.manualOut = false;
      this.engine.run(this.state);
      this.selected = { kind: 'node', index };
    });
  }
  convert(type: NodeType): void {
    if (this.dragging) return;
    const hovered = this.pointer ? this.hitNode(this.pointer) : -1;
    const index = hovered >= 0 ? hovered : (this.selected?.index ?? -1);
    this.convertIndex(index, type);
  }
  convertSelected(type: NodeType): void {
    if (!this.dragging) this.convertIndex(this.selected?.index ?? -1, type);
  }
  private convertIndex(index: number, type: NodeType): void {
    if (index < 0 || index >= this.state.nodes.length) return;
    this.edit(() => {
      this.engine.run(this.state, 1, index, type);
      this.selected = { kind: 'node', index };
    });
  }
  loadScene(index: number, width: number, height: number): void {
    this.edit(() => {
      const scene = makeScene(index, width, height);
      this.state = scene.state;
      this.selected = null;
      this.engine.run(this.state, scene.close ? (scene.close === 2 ? 5 : 4) : 0);
      this.showHandles = true;
    });
  }
  undo(): void {
    if (!this.cancelGesture()) this.restore(this.history.undo(this.snapshot()));
    this.changed();
  }
  redo(): void {
    this.cancelGesture();
    this.restore(this.history.redo(this.snapshot()));
    this.changed();
  }

  cancelGesture(pointerId?: number): boolean {
    if (!this.gesture || (pointerId !== undefined && this.gesture.pointerId !== pointerId))
      return false;
    this.restore(this.gesture.before);
    this.gesture = null;
    this.changed();
    return true;
  }

  pointerDown(point: Point, pointerId: number, ctrl: boolean, shift: boolean): void {
    if (this.gesture) return;
    this.pointer = point;
    const before = this.snapshot();
    const target = this.hitTarget(point);
    let index = target?.index ?? -1;
    const kind = target?.kind ?? 'node';
    let potentialClose = false;
    if (kind === 'node' && index >= 0) {
      potentialClose = index === 0 && this.state.nodes.length >= 2 && !this.state.close;
    } else if (index < 0) {
      // As in the C++ demo, the next click after finishing starts a new path.
      if (this.state.finished || this.state.close) this.state = emptyState();
      this.state.nodes.push(makeNode(point.x, point.y, ctrl ? 2 : shift ? 1 : 0));
      this.engine.run(this.state);
      index = this.state.nodes.length - 1;
    }
    this.selected = { kind, index };
    this.gesture = { pointerId, kind, index, press: point, potentialClose, moved: false, before };
    this.changed();
  }

  pointerMove(point: Point, pointerId: number): void {
    this.pointer = point;
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== pointerId) {
      this.changed();
      return;
    }
    if (gesture.potentialClose) {
      if (distanceSq(point, gesture.press) <= 25) {
        this.changed();
        return;
      }
      gesture.potentialClose = false;
    }
    // Clicking a collapsed tip highlights it without creating a real handle.
    if (gesture.kind !== 'node' && !gesture.moved && distanceSq(point, gesture.press) <= 25) {
      this.changed();
      return;
    }
    gesture.moved = true;
    const node = this.state.nodes[gesture.index];
    if (gesture.kind === 'node') {
      const start = this.state.nodes[0];
      const snap =
        !this.state.close &&
        this.state.nodes.length >= 3 &&
        gesture.index === this.state.nodes.length - 1 &&
        distanceSq(point, start) <= 100;
      node.x = snap ? start.x : point.x;
      node.y = snap ? start.y : point.y;
      this.engine.run(this.state);
    } else
      this.engine.run(this.state, gesture.kind === 'in' ? 2 : 3, gesture.index, point.x, point.y);
    this.changed();
  }

  pointerUp(pointerId: number, shift: boolean, release?: Point): void {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== pointerId) return;
    // A fast release can arrive beyond the last delivered pointermove. Finish
    // the edit at the release position, while preserving offset selection clicks.
    if (release) {
      if (gesture.moved || distanceSq(release, gesture.press) > 25)
        this.pointerMove(release, pointerId);
      else this.pointer = release;
    }
    const { nodes } = this.state;
    const last = nodes.at(-1)!;
    const droppedOnStart =
      gesture.kind === 'node' &&
      gesture.index === nodes.length - 1 &&
      !this.state.close &&
      nodes.length >= 3 &&
      distanceSq(last, nodes[0]) === 0;
    if (gesture.potentialClose || droppedOnStart) {
      if (droppedOnStart) nodes.pop();
      this.engine.run(this.state, shift ? 5 : 4);
      this.state.finished = true;
      this.selected = { kind: 'node', index: 0 };
    }
    this.gesture = null;
    this.commit(gesture.before);
    this.changed();
  }
}
