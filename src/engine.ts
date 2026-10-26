import type { Close, EditorState } from './model.ts';

export interface WasmModule {
  HEAPF64: Float64Array;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _bg_run(
    pointer: number,
    count: number,
    close: number,
    operation: number,
    index: number,
    a: number,
    b: number,
  ): number;
}

/** A small typed transport for the original C++ code; no curve rules in JS. */
export class BezigonEngine {
  private module: WasmModule;
  constructor(module: WasmModule) {
    this.module = module;
  }

  run(state: EditorState, operation = 0, index = -1, a = 0, b = 0): void {
    const { nodes } = state;
    if (!nodes.length) return;
    const stride = 16;
    const pointer = this.module._malloc(nodes.length * stride * 8);
    if (!pointer) throw new Error('Could not allocate WebAssembly memory.');
    try {
      // malloc may grow the memory, so obtain the view afterwards.
      let heap = this.module.HEAPF64;
      const start = pointer / 8;
      nodes.forEach((n, i) =>
        heap.set(
          [
            n.x,
            n.y,
            n.type,
            +n.cusp,
            +n.manualIn,
            +n.manualOut,
            n.inX,
            n.inY,
            n.outX,
            n.outY,
            0,
            0,
            0,
            0,
            0,
            0,
          ],
          start + i * stride,
        ),
      );
      state.close = this.module._bg_run(
        pointer,
        nodes.length,
        state.close,
        operation,
        index,
        a,
        b,
      ) as Close;
      heap = this.module.HEAPF64;
      nodes.forEach((n, i) => {
        const row = heap.subarray(start + i * stride, start + (i + 1) * stride);
        n.x = row[0];
        n.y = row[1];
        n.type = row[2] as typeof n.type;
        n.cusp = !!row[3];
        n.manualIn = !!row[4];
        n.manualOut = !!row[5];
        n.inX = row[6];
        n.inY = row[7];
        n.outX = row[8];
        n.outY = row[9];
        n.axisIn = row[14] ? { x: row[10], y: row[11] } : null;
        n.axisOut = row[15] ? { x: row[12], y: row[13] } : null;
      });
    } finally {
      this.module._free(pointer);
    }
  }
}
