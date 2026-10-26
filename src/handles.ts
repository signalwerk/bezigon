import type { BezigonNode, Point } from './model.ts';

export type HandleSide = 'in' | 'out';
export interface EditTarget {
  kind: 'node' | HandleSide;
  index: number;
}
export interface VisibleHandle extends Point {
  kind: HandleSide;
  index: number;
  manual: boolean;
  collapsed: boolean;
}

/** Shared positions for drawing and hit testing, including collapsed Tangent tips. */
export function visibleHandles(node: BezigonNode, index: number): VisibleHandle[] {
  const handles: VisibleHandle[] = [];
  for (const kind of ['in', 'out'] as const) {
    const x = kind === 'in' ? node.inX : node.outX;
    const y = kind === 'in' ? node.inY : node.outY;
    const axis = kind === 'in' ? node.axisIn : node.axisOut;
    const collapsed = x === 0 && y === 0;
    if (collapsed && (node.type !== 2 || !axis)) continue;
    // These short dashed arms are GUI affordances, not Bezier control points.
    // The C++ library computes the actual handle once its tip is dragged.
    handles.push({
      kind,
      index,
      collapsed,
      x: node.x + (collapsed ? axis!.x * 24 : x),
      y: node.y + (collapsed ? axis!.y * 24 : y),
      manual: kind === 'in' ? node.manualIn : node.manualOut,
    });
  }
  return handles;
}
