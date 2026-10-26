import type { EditorState, Point } from './model.ts';
import { visibleHandles } from './handles.ts';
import type { EditTarget } from './handles.ts';

const colors = ['#d35d53', '#427eaa', '#bc852e'];

function sameTarget(a: EditTarget | null, b: EditTarget): boolean {
  return a?.kind === b.kind && a.index === b.index;
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  point: Point,
  color: string,
  selected = false,
): void {
  ctx.beginPath();
  ctx.arc(point.x, point.y, 13, 0, Math.PI * 2);
  if (selected) {
    ctx.fillStyle = color + '10';
    ctx.fill();
  }
  ctx.strokeStyle = color + (selected ? 'cc' : '80');
  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.stroke();
}

export function render(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: EditorState,
  showHandles: boolean,
  hover: EditTarget | null,
  active: EditTarget | null,
  selected: EditTarget | null,
  pointer: Point | null,
): void {
  ctx.clearRect(0, 0, width, height);
  const { nodes } = state;
  const handles = showHandles ? nodes.flatMap(visibleHandles) : [];

  for (const handle of handles) {
    const node = nodes[handle.index];
    ctx.lineWidth = 1;
    ctx.strokeStyle = handle.manual ? '#75977e' : '#b4c3b8';
    ctx.setLineDash(handle.collapsed ? [2, 3] : []);
    ctx.beginPath();
    ctx.moveTo(node.x, node.y);
    ctx.lineTo(handle.x, handle.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (nodes.length > 1) {
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    const segments = state.close ? nodes.length : nodes.length - 1;
    for (let i = 0; i < segments; i++) {
      const a = nodes[i],
        b = nodes[(i + 1) % nodes.length];
      ctx.bezierCurveTo(a.x + a.outX, a.y + a.outY, b.x + b.inX, b.y + b.inY, b.x, b.y);
    }
    if (state.close) {
      ctx.closePath();
      ctx.fillStyle = '#427eaa08';
      ctx.fill();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#303d3a';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  for (const handle of handles) {
    const isSelected = sameTarget(selected, handle);
    const highlighted = isSelected || sameTarget(hover, handle) || sameTarget(active, handle);
    if (highlighted) drawRing(ctx, handle, '#75977e', isSelected);
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = handle.manual || highlighted ? '#75977e' : '#fcfcf9';
    ctx.fill();
    ctx.strokeStyle = '#75977e';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  nodes.forEach((node, i) => {
    const color = colors[node.type];
    const target = { kind: 'node', index: i } as const;
    const isSelected = sameTarget(selected, target);
    if (isSelected || sameTarget(hover, target) || sameTarget(active, target))
      drawRing(ctx, node, color, isSelected);
    else if (i === 0 && !state.close && nodes.length >= 2) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, 11, 0, Math.PI * 2);
      ctx.strokeStyle = '#9daaa080';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    if (node.type === 0) ctx.rect(node.x - 4.5, node.y - 4.5, 9, 9);
    else if (node.type === 1) ctx.arc(node.x, node.y, 5, 0, Math.PI * 2);
    else {
      ctx.moveTo(node.x, node.y - 6);
      ctx.lineTo(node.x + 6, node.y + 5);
      ctx.lineTo(node.x - 6, node.y + 5);
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  });

  if (pointer && !state.finished && !state.close && nodes.length && !hover && !active) {
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#303d3a40';
    ctx.fill();
  }
}
