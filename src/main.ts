import './style.css';
import { BezigonEngine } from './engine.ts';
import type { WasmModule } from './engine.ts';
import { Editor } from './editor.ts';
import { render } from './render.ts';
import type { NodeType } from './model.ts';

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = element<HTMLCanvasElement>('canvas');
const context = canvas.getContext('2d')!;
const undo = element<HTMLButtonElement>('undo');
const redo = element<HTMLButtonElement>('redo');
const handles = element<HTMLButtonElement>('handles');
const examples = element<HTMLSelectElement>('examples');
const status = element('status');
const mode = element('mode');
const palette = element('point-palette');
const selectedPointLabel = element('selected-point-label');
const resetSelectedHandles = element<HTMLButtonElement>('reset-selected-handles');
const pointTypeButtons = Array.from(
  palette.querySelectorAll<HTMLButtonElement>('[data-point-type]'),
);
let width = 0,
  height = 0;
let editor: Editor | null = null;
let scheduled = false;

function draw(): void {
  scheduled = false;
  if (!editor) return;
  const { state } = editor;
  const hover = editor.pointer ? editor.hitTarget(editor.pointer) : null;
  render(
    context,
    width,
    height,
    state,
    editor.showHandles,
    hover,
    editor.activeTarget,
    editor.selectedTarget,
    editor.pointer,
  );
  element('empty').hidden = state.nodes.length > 0;
  undo.disabled = !editor.history.canUndo && !editor.dragging;
  redo.disabled = !editor.history.canRedo;
  handles.setAttribute('aria-pressed', String(editor.showHandles));
  const selection = editor.selectedTarget;
  const selectedNode = selection ? state.nodes[selection.index] : null;
  palette.hidden = !selectedNode;
  resetSelectedHandles.disabled =
    editor.dragging || !selectedNode || !(selectedNode.manualIn || selectedNode.manualOut);
  if (selectedNode && selection) selectedPointLabel.textContent = `Point ${selection.index + 1}`;
  for (const button of pointTypeButtons) {
    button.setAttribute(
      'aria-pressed',
      String(selectedNode?.type === Number(button.dataset.pointType)),
    );
    button.disabled = editor.dragging;
  }
  canvas.style.cursor = editor.dragging ? 'grabbing' : hover ? 'grab' : 'crosshair';
  const manual = state.nodes.filter((n) => n.manualIn || n.manualOut).length;
  status.textContent = state.nodes.length
    ? `${state.nodes.length} ${state.nodes.length === 1 ? 'point' : 'points'} · ${state.close === 2 ? 'Closed with cusp' : state.close ? 'Closed path' : state.finished ? 'Finished open path' : 'Drawing'}${manual ? ` · ${manual} manually adjusted` : ''}`
    : 'Ready · Click to place your first point';
}
function requestDraw(): void {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(draw);
  }
}

new ResizeObserver(() => {
  const rect = canvas.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  requestDraw();
}).observe(element('workspace'));

const point = (event: PointerEvent) => {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};
function updateMode(event: Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey'>): void {
  mode.textContent = event.ctrlKey
    ? 'Ctrl + click · Tangent'
    : event.shiftKey
      ? 'Shift + click · Smooth / cusp close'
      : 'Click · Corner';
}

// macOS reserves Ctrl-click for context menus. Handle the control-primary
// pointer gesture and suppress only its context menu; ordinary right-click finishes.
canvas.addEventListener('pointerdown', (event) => {
  if (!editor) return;
  if (event.button === 2 && !event.ctrlKey) {
    editor.finish();
    event.preventDefault();
    return;
  }
  if ((event.button !== 0 && !(event.button === 2 && event.ctrlKey)) || editor.dragging) return;
  event.preventDefault();
  canvas.focus();
  canvas.setPointerCapture(event.pointerId);
  editor.pointerDown(point(event), event.pointerId, event.ctrlKey, event.shiftKey);
  updateMode(event);
});
canvas.addEventListener('pointermove', (event) => {
  editor?.pointerMove(point(event), event.pointerId);
  updateMode(event);
});
canvas.addEventListener('pointerup', (event) => {
  editor?.pointerUp(event.pointerId, event.shiftKey, point(event));
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('pointercancel', (event) => editor?.cancelGesture(event.pointerId));
canvas.addEventListener('lostpointercapture', (event) => {
  // An older loss event must not cancel a new capture for the same pointer.
  // Unexpected capture loss ends the edit at its last position; pointercancel
  // is the explicit signal to roll a gesture back.
  if (!canvas.hasPointerCapture(event.pointerId))
    editor?.pointerUp(event.pointerId, event.shiftKey);
});
canvas.addEventListener('pointerleave', () => {
  if (editor && !editor.dragging) {
    editor.pointer = null;
    requestDraw();
  }
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('blur', () => {
  editor?.cancelGesture();
  mode.textContent = 'Click · Corner';
});

undo.addEventListener('click', () => editor?.undo());
redo.addEventListener('click', () => editor?.redo());
handles.addEventListener('click', () => editor?.toggleHandles());
resetSelectedHandles.addEventListener('click', () => editor?.resetSelectedHandles());
for (const button of pointTypeButtons) {
  button.addEventListener('click', () =>
    editor?.convertSelected(Number(button.dataset.pointType) as NodeType),
  );
}
element('clear').addEventListener('click', () => editor?.clear());
examples.addEventListener('change', () => {
  if (examples.value !== '') editor?.loadScene(Number(examples.value), width, height);
  examples.value = '';
  canvas.focus();
});

window.addEventListener('keydown', (event) => {
  if (
    !editor ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement
  )
    return;
  updateMode(event);
  const key = event.key.toLowerCase();
  const command = event.metaKey || event.ctrlKey;
  if (command && key === 'z') {
    event.preventDefault();
    event.shiftKey ? editor.redo() : editor.undo();
    return;
  }
  if (command && key === 'y') {
    event.preventDefault();
    editor.redo();
    return;
  }
  if (command || event.altKey || event.repeat) return;
  // Let focused toolbar buttons retain their normal Enter/Space activation.
  if (event.target instanceof HTMLButtonElement && (key === 'enter' || key === ' ')) return;
  if (key === 'escape') editor.clear();
  else if (key === 'enter') editor.finish();
  else if (key === 'd') editor.toggleHandles();
  else if (key === 'r') editor.resetHandles();
  else if (key === 'c' || key === 's' || key === 't')
    editor.convert(key === 'c' ? 0 : key === 's' ? 1 : 2);
  else if (/^[1-7]$/.test(key)) editor.loadScene(Number(key) - 1, width, height);
  else return;
  event.preventDefault();
});
window.addEventListener('keyup', updateMode);

try {
  const wasmBase = new URL(`${import.meta.env.BASE_URL}wasm/`, document.baseURI).href;
  const moduleUrl = `${wasmBase}bezigon.mjs`;
  const { default: createBezigon } = (await import(/* @vite-ignore */ moduleUrl)) as {
    default: (options: { locateFile: (file: string) => string }) => Promise<WasmModule>;
  };
  const module = await createBezigon({ locateFile: (file) => `${wasmBase}${file}` });
  editor = new Editor(new BezigonEngine(module), requestDraw);
  canvas.setAttribute('aria-busy', 'false');
  requestDraw();
} catch (error) {
  console.error(error);
  status.textContent = 'Could not load Bezigon. Run npm run wasm, then reload.';
  element('empty').querySelector('h1')!.textContent = 'The curve engine could not start.';
}
