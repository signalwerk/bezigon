import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BezigonEngine } from '../src/engine.ts';
import type { WasmModule } from '../src/engine.ts';
import { Editor } from '../src/editor.ts';
import { emptyState, makeNode } from '../src/model.ts';
import type { NodeType } from '../src/model.ts';

let engine: BezigonEngine;
before(async () => {
  // Exercise the actual compiled C++/WASM, including the ABI transport.
  const { default: createBezigon } = await import('../public/wasm/bezigon.mjs');
  const wasmBinary = await readFile(new URL('../public/wasm/bezigon.wasm', import.meta.url));
  engine = new BezigonEngine((await createBezigon({ wasmBinary })) as WasmModule);
});

const point = (x: number, y: number) => ({ x, y });
function click(editor: Editor, x: number, y: number, type: NodeType = 0): void {
  editor.pointerDown(point(x, y), 1, type === 2, type === 1);
  editor.pointerUp(1, false);
}
const editor = () => new Editor(engine, () => {});
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('WASM calculates the original 0.39 handles for a smooth square', () => {
  const state = emptyState();
  state.nodes = [
    [100, 100],
    [300, 100],
    [300, 300],
    [100, 300],
  ].map(([x, y]) => makeNode(x, y, 1));
  engine.run(state, 4);
  assert.equal(state.close, 1);
  const expected = (200 * 0.39) / Math.sqrt(2);
  near(state.nodes[0].outX, expected);
  near(state.nodes[0].outY, -expected);
  near(state.nodes[0].inX, -expected);
  near(state.nodes[0].inY, expected);
});

test('two smooth nodes close to a loop; modifier close creates a cusp', () => {
  const state = emptyState();
  state.nodes = [makeNode(100, 100, 1), makeNode(300, 100, 1)];
  engine.run(state, 4);
  near(state.nodes[0].outX, 0);
  near(state.nodes[0].outY, 78);
  engine.run(state, 5);
  assert.equal(state.close, 2);
  assert.equal(state.nodes[0].type, 0);
  assert.equal(state.nodes[0].cusp, true);
  near(state.nodes[0].inX, 78);
});

test('restoring a modifier-closed path preserves subsequent node conversions', () => {
  const state = emptyState();
  state.nodes = [makeNode(100, 100, 1), makeNode(300, 100, 1), makeNode(200, 300, 1)];
  engine.run(state, 5);
  engine.run(state, 1, 0, 1);
  const expected = structuredClone(state);
  engine.run(state);
  assert.deepEqual(state, expected);
});

test('manual smooth handles and their flags survive WASM round trips', () => {
  const state = emptyState();
  state.nodes = [makeNode(100, 100, 0), makeNode(200, 200, 1), makeNode(300, 100, 0)];
  engine.run(state);
  engine.run(state, 3, 1, 250, 180);
  const expected = structuredClone(state.nodes[1]);
  engine.run(state);
  assert.deepEqual(state.nodes[1], expected);
  assert.equal(expected.manualIn, true);
  assert.equal(expected.manualOut, true);
});

test('Tangent handle drag is constrained by C++, not TypeScript', () => {
  const state = emptyState();
  state.nodes = [makeNode(100, 100, 0), makeNode(200, 100, 2), makeNode(300, 200, 0)];
  engine.run(state);
  near(state.nodes[1].axisOut!.x, 1);
  near(state.nodes[1].axisOut!.y, 0);
  engine.run(state, 3, 1, 260, 150);
  near(state.nodes[1].outY, 0);
  near(state.nodes[1].outX, Math.hypot(60, 50));
});

test('modifier placement uses Ctrl before Shift, matching the demo', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 200, 100, 1);
  e.pointerDown(point(300, 100), 1, true, true);
  e.pointerUp(1, false);
  assert.deepEqual(
    e.state.nodes.map((n) => n.type),
    [0, 1, 2],
  );
});

test('a whole node drag is one undo step, with redo and branch invalidation', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 300, 100, 1);
  const before = structuredClone(e.state);
  e.pointerDown(point(300, 100), 1, false, false);
  for (let x = 301; x <= 400; x++) e.pointerMove(point(x, 150), 1);
  e.pointerUp(1, false);
  const after = structuredClone(e.state);
  e.undo();
  assert.deepEqual(e.state, before);
  e.redo();
  assert.deepEqual(e.state, after);
  e.undo();
  click(e, 500, 100);
  assert.equal(e.history.canRedo, false);
});

test('click to close uses Shift at release; undo restores the original type', () => {
  const e = editor();
  click(e, 100, 100, 1);
  click(e, 300, 100, 1);
  const before = structuredClone(e.state);
  e.pointerDown(point(100, 100), 1, false, false);
  e.pointerUp(1, true);
  assert.equal(e.state.close, 2);
  assert.equal(e.state.nodes[0].cusp, true);
  e.undo();
  assert.deepEqual(e.state, before);
  e.redo();
  assert.equal(e.state.close, 2);
});

test('dragging the final node to the start snaps, merges, and closes', () => {
  const e = editor();
  click(e, 100, 100, 1);
  click(e, 300, 100, 1);
  click(e, 300, 300, 1);
  const before = structuredClone(e.state);
  e.pointerDown(point(300, 300), 1, false, false);
  e.pointerMove(point(105, 103), 1);
  e.pointerUp(1, false);
  assert.equal(e.state.nodes.length, 2);
  assert.equal(e.state.close, 1);
  e.undo();
  assert.deepEqual(e.state, before);
});

test('dragging the first node beyond the threshold moves rather than closes', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 300, 100);
  e.pointerDown(point(100, 100), 1, false, false);
  e.pointerMove(point(120, 130), 1);
  e.pointerUp(1, false);
  assert.equal(e.state.close, 0);
  assert.equal(e.state.nodes[0].x, 120);
});

test('a collapsed Tangent handle is pulled by plain drag and supports undo/redo', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 200, 100, 2);
  click(e, 300, 200);
  const before = structuredClone(e.state);
  e.pointerDown(point(224, 100), 1, false, false);
  assert.deepEqual(e.activeTarget, { kind: 'out', index: 1 });
  e.pointerMove(point(260, 120), 1);
  e.pointerUp(1, false);
  assert.equal(e.state.nodes[1].x, 200);
  assert.equal(e.state.nodes[1].y, 100);
  assert.equal(e.state.nodes[1].manualOut, true);
  near(e.state.nodes[1].outY, 0);
  const after = structuredClone(e.state);
  e.undo();
  assert.deepEqual(e.state, before);
  e.redo();
  assert.deepEqual(e.state, after);
});

test('Tangent on-curve points still move with a plain drag', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 200, 100, 2);
  click(e, 300, 200);
  e.pointerDown(point(200, 100), 1, false, false);
  e.pointerMove(point(230, 130), 1);
  e.pointerUp(1, false);
  assert.equal(e.state.nodes[1].x, 230);
  assert.equal(e.state.nodes[1].y, 130);
  assert.equal(e.state.nodes[1].manualOut, false);
});

test('clicking a collapsed tip does not change geometry or add an undo step', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 200, 100, 2);
  click(e, 300, 200);
  const before = structuredClone(e.state);
  e.pointerDown(point(224, 100), 1, false, false);
  e.pointerMove(point(225, 101), 1);
  e.pointerUp(1, false);
  assert.deepEqual(e.state, before);
  e.undo();
  assert.equal(e.state.nodes.length, 2);
});

test('handle hover targets match visibility, with on-curve points taking priority', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 200, 100, 2);
  click(e, 300, 200);
  assert.deepEqual(e.hitTarget(point(224, 100)), { kind: 'out', index: 1 });
  e.toggleHandles();
  assert.equal(e.hitTarget(point(224, 100)), null);
  e.toggleHandles();
  e.state.nodes[1].outX = -100;
  e.state.nodes[1].outY = 0;
  assert.deepEqual(e.hitTarget(point(100, 100)), { kind: 'node', index: 0 });
});

test('handle drag, conversion and reset are individually undoable', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 300, 100);
  click(e, 300, 300);
  const n = e.state.nodes[1];
  const tip = point(n.x + n.outX, n.y + n.outY);
  const original = structuredClone(e.state);
  e.pointerDown(tip, 1, false, false);
  e.pointerMove(point(350, 160), 1);
  e.pointerUp(1, false);
  const manual = structuredClone(e.state);
  assert.equal(e.state.nodes[1].manualOut, true);
  e.resetHandles();
  assert.equal(e.state.nodes[1].manualOut, false);
  e.undo();
  assert.deepEqual(e.state, manual);
  e.undo();
  assert.deepEqual(e.state, original);
  e.pointer = point(300, 100);
  e.convert(1);
  assert.equal(e.state.nodes[1].type, 1);
  e.undo();
  assert.deepEqual(e.state, original);
});

test('cancelled gestures roll back; other pointer IDs cannot alter the gesture', () => {
  const e = editor();
  click(e, 100, 100);
  const original = structuredClone(e.state);
  e.pointerDown(point(300, 300), 1, false, false);
  e.pointerMove(point(400, 400), 2);
  e.pointerUp(2, false);
  assert.equal(e.state.nodes[1].x, 300);
  assert.equal(e.dragging, true);
  e.cancelGesture();
  assert.deepEqual(e.state, original);
  e.undo();
  assert.equal(e.state.nodes.length, 0);
});

test('finish, starting a new path, clear, and loading examples are undoable', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 300, 100);
  const drawing = structuredClone(e.state);
  e.finish();
  const finished = structuredClone(e.state);
  click(e, 500, 300);
  assert.equal(e.state.nodes.length, 1);
  e.undo();
  assert.deepEqual(e.state, finished);
  e.undo();
  assert.deepEqual(e.state, drawing);
  e.loadScene(5, 900, 600);
  assert.equal(e.state.close, 2);
  const scene = structuredClone(e.state);
  e.clear();
  assert.equal(e.state.nodes.length, 0);
  e.undo();
  assert.deepEqual(e.state, scene);
  e.undo();
  assert.deepEqual(e.state, drawing);
});

test('all seven demo scenes calculate finite handles', () => {
  const e = editor();
  for (let i = 0; i < 7; i++) {
    e.loadScene(i, 900, 600);
    for (const n of e.state.nodes)
      for (const value of [n.inX, n.inY, n.outX, n.outY]) assert.ok(Number.isFinite(value));
  }
});

test('the last clicked point remains selected when hovering elsewhere', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 300, 100);
  click(e, 300, 300);
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 2 });
  e.pointerMove(point(300, 100), 1);
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 2 });
  click(e, 300, 100);
  e.pointer = null;
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 1 });
  // Selecting an existing point adds no geometry edit to undo.
  e.undo();
  assert.equal(e.state.nodes.length, 2);
});

test('the palette converts the selected point even when another point is hovered', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 300, 100);
  click(e, 300, 300);
  e.pointer = point(300, 100);
  e.convertSelected(1);
  assert.equal(e.state.nodes[1].type, 0);
  assert.equal(e.state.nodes[2].type, 1);
  e.undo();
  assert.equal(e.state.nodes[2].type, 0);
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 2 });
  e.redo();
  assert.equal(e.state.nodes[2].type, 1);
  e.convertSelected(0);
  assert.equal(e.state.nodes[2].cusp, true);
});

test('a selected handle persists and the palette converts its owning point', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 200, 100, 2);
  click(e, 300, 200);
  click(e, 224, 100);
  e.pointer = null;
  assert.deepEqual(e.selectedTarget, { kind: 'out', index: 1 });
  e.convertSelected(1);
  assert.equal(e.state.nodes[1].type, 1);
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 1 });
  e.undo();
  assert.deepEqual(e.selectedTarget, { kind: 'out', index: 1 });
});

test('selection follows merged points and is restored on undo, redo, clear and cancel', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 300, 100);
  click(e, 300, 300);
  e.pointerDown(point(300, 300), 1, false, false);
  e.pointerMove(point(100, 100), 1);
  e.pointerUp(1, false);
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 0 });
  e.undo();
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 2 });
  e.redo();
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 0 });
  e.clear();
  assert.equal(e.selectedTarget, null);
  e.undo();
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 0 });
  e.pointerDown(point(400, 400), 1, false, false);
  e.cancelGesture();
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 0 });
  e.loadScene(2, 900, 600);
  assert.equal(e.selectedTarget, null);
});

test('a rapid placement drag uses its release position even without a move event', () => {
  const e = editor();
  click(e, 100, 100);
  e.pointerDown(point(300, 100), 1, false, false);
  e.pointerUp(1, false, point(400, 200));
  assert.equal(e.state.nodes.length, 2);
  assert.equal(e.state.nodes[1].x, 400);
  assert.equal(e.state.nodes[1].y, 200);
  e.undo();
  assert.equal(e.state.nodes.length, 1);
  e.redo();
  assert.equal(e.state.nodes[1].x, 400);
});

test('a release after the last move updates both node and handle drags', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 300, 100);
  click(e, 300, 300);
  e.pointerDown(point(300, 300), 1, false, false);
  e.pointerMove(point(350, 350), 1);
  e.pointerUp(1, false, point(400, 400));
  assert.equal(e.state.nodes[2].x, 400);
  assert.equal(e.state.nodes[2].y, 400);
  const n = e.state.nodes[1];
  e.pointerDown(point(n.x + n.outX, n.y + n.outY), 1, false, false);
  e.pointerMove(point(350, 200), 1);
  e.pointerUp(1, false, point(400, 250));
  near(n.outX, 100);
  near(n.outY, 150);
});

test('release coordinates distinguish a fast first-node drag from a closing click', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 300, 100);
  e.pointerDown(point(100, 100), 1, false, false);
  e.pointerUp(1, false, point(130, 130));
  assert.equal(e.state.close, 0);
  assert.equal(e.state.nodes[0].x, 130);
});

test('a selection click within a point does not move it to the click offset', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 300, 100);
  click(e, 300, 300);
  const before = structuredClone(e.state);
  e.pointerDown(point(306, 100), 1, false, false);
  e.pointerUp(1, false, point(306, 100));
  assert.deepEqual(e.state, before);
});

test('an unrelated pointer cancellation cannot erase the current placement', () => {
  const e = editor();
  click(e, 100, 100);
  e.pointerDown(point(300, 100), 1, false, false);
  assert.equal(e.cancelGesture(2), false);
  e.pointerUp(1, false, point(350, 150));
  assert.equal(e.state.nodes.length, 2);
  assert.equal(e.state.nodes[1].x, 350);
});

test('resetting selected handles keeps other manual points and supports undo/redo', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 300, 100);
  click(e, 300, 300);
  click(e, 500, 300);
  const automatic = structuredClone(e.state.nodes[1]);
  e.pointerDown(point(300, 178), 1, false, false);
  e.pointerMove(point(350, 180), 1);
  e.pointerUp(1, false);
  e.pointerDown(point(378, 300), 1, false, false);
  e.pointerMove(point(400, 350), 1);
  e.pointerUp(1, false);
  click(e, 300, 100);
  const before = structuredClone(e.state);
  assert.equal(before.nodes[1].manualOut, true);
  assert.equal(before.nodes[2].manualOut, true);
  e.resetSelectedHandles();
  assert.deepEqual(e.state.nodes[1], automatic);
  assert.deepEqual(e.state.nodes[2], before.nodes[2]);
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 1 });
  const after = structuredClone(e.state);
  e.undo();
  assert.deepEqual(e.state, before);
  e.redo();
  assert.deepEqual(e.state, after);
});

test('resetting a selected Tangent handle returns it to automatic and selects its point', () => {
  const e = editor();
  click(e, 100, 100);
  click(e, 200, 100, 2);
  click(e, 300, 200);
  e.pointerDown(point(224, 100), 1, false, false);
  e.pointerMove(point(260, 120), 1);
  e.pointerUp(1, false);
  const before = structuredClone(e.state);
  e.resetSelectedHandles();
  assert.equal(e.state.nodes[1].manualOut, false);
  near(e.state.nodes[1].outX, 0);
  near(e.state.nodes[1].outY, 0);
  assert.deepEqual(e.selectedTarget, { kind: 'node', index: 1 });
  e.undo();
  assert.deepEqual(e.state, before);
  assert.deepEqual(e.selectedTarget, { kind: 'out', index: 1 });
});

test('resetting an automatic point adds no undo step', () => {
  const e = editor();
  e.resetSelectedHandles();
  click(e, 100, 100);
  e.resetSelectedHandles();
  e.undo();
  assert.equal(e.state.nodes.length, 0);
});
