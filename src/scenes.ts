// The seven sets of point positions/types from the upstream demo_scenes.h.
// Fitting them to the canvas is GUI work; handles are calculated by WASM.
import { makeNode } from './model.ts';
import type { Close, EditorState, NodeType } from './model.ts';

const scenes: { close: Close; points: [number, number, NodeType][] }[] = [
  {
    close: 1,
    points: [
      [431, 27, 0],
      [307, 178, 1],
      [119, 220, 0],
      [121, 488, 1],
      [430, 833, 0],
      [716, 446, 1],
      [733, 214, 0],
      [589, 206, 1],
    ],
  },
  {
    close: 0,
    points: [
      [100, 500, 0],
      [300, 500, 2],
      [450, 380, 1],
      [600, 380, 1],
    ],
  },
  {
    close: 1,
    points: [
      [150, 200, 0],
      [450, 200, 2],
      [580, 300, 1],
      [450, 400, 2],
      [150, 400, 0],
    ],
  },
  {
    close: 1,
    points: [
      [400, 100, 1],
      [590, 238, 1],
      [517, 462, 2],
      [283, 462, 1],
      [210, 238, 1],
    ],
  },
  {
    close: 1,
    points: [
      [250, 150, 0],
      [550, 150, 0],
      [550, 450, 0],
      [250, 450, 0],
    ],
  },
  {
    close: 2,
    points: [
      [400, 100, 1],
      [600, 250, 1],
      [550, 450, 1],
      [250, 450, 1],
      [200, 250, 1],
    ],
  },
  {
    close: 0,
    points: [
      [110, 354, 2],
      [396, 219, 1],
      [686, 404, 2],
      [962, 218, 1],
    ],
  },
];

export function makeScene(
  index: number,
  width: number,
  height: number,
): { state: EditorState; close: Close } {
  const scene = scenes[index];
  const xs = scene.points.map((p) => p[0]),
    ys = scene.points.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs);
  const minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const scale = Math.max(
    0.05,
    Math.min(1, (width - 120) / (maxX - minX), (height - 100) / (maxY - minY)),
  );
  return {
    state: {
      close: 0,
      finished: true,
      nodes: scene.points.map(([x, y, type]) =>
        makeNode(
          width / 2 + (x - (minX + maxX) / 2) * scale,
          height / 2 + (y - (minY + maxY) / 2) * scale,
          type,
        ),
      ),
    },
    close: scene.close,
  };
}
