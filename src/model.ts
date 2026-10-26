export type NodeType = 0 | 1 | 2;
export type Close = 0 | 1 | 2;
export interface Point {
  x: number;
  y: number;
}
export interface BezigonNode extends Point {
  type: NodeType;
  cusp: boolean;
  manualIn: boolean;
  manualOut: boolean;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
  axisIn: Point | null;
  axisOut: Point | null;
}
export interface EditorState {
  nodes: BezigonNode[];
  close: Close;
  finished: boolean;
}
export const emptyState = (): EditorState => ({ nodes: [], close: 0, finished: false });
export const makeNode = (x: number, y: number, type: NodeType): BezigonNode => ({
  x,
  y,
  type,
  cusp: false,
  manualIn: false,
  manualOut: false,
  inX: 0,
  inY: 0,
  outX: 0,
  outY: 0,
  axisIn: null,
  axisOut: null,
});
