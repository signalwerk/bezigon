# Bezigon canvas playground

A small Vite + TypeScript app using the original **Bezigon 4.2.0 C++** library
compiled to WebAssembly. Canvas drawing, pointer/keyboard handling, examples and
undo/redo are TypeScript. There is no JavaScript reimplementation of the curve rules.

## Run

Requires Node.js **22.18+** (or 24+) and [Emscripten](https://emscripten.org/docs/getting_started/downloads.html)
with `emcc` on your PATH. On macOS, `brew install emscripten` also works.

```sh
npm install
npm run dev
```

Open the Local URL printed by Vite, normally **http://127.0.0.1:5173**.
The dev and production commands compile WASM automatically. Generated files go
in `public/wasm/`; Emscripten's local cache is `.emscripten-cache/`. Both are ignored.
Set `EMCC` to a compiler path or `EM_CACHE` to another cache if needed.
After changing the C++ source during development, run `npm run wasm` and reload.

```sh
npm run build       # WASM + TypeScript checking + dist/
npm run preview     # serve the production build
npm test            # actual WASM bridge + editing/history tests
npx playwright install chromium
npm run test:browser # production build + headless canvas interaction tests
npm run format      # format all supported project files
npm run format:check # check formatting without changing files
```

To use an installed Chrome for browser tests instead of downloading Chromium,
set `CHROME_PATH` to its executable. Only the build needs Emscripten; `dist/` can
be served by a static host, including under a subdirectory.

## Controls

The controls follow the supplied Windows/EGE 4.2.0 demo, including Ctrl for
Tangent nodes (rather than FreeHand's original Alt/Option). Handles are dragged
directly without a modifier; collapsed Tangent handles have dashed draggable tips.

| Action                                                           | Control                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Place Corner / Smooth / Tangent                                  | Click / Shift-click / Ctrl-click                                       |
| Move a node or visible handle                                    | Drag                                                                   |
| Extend a collapsed Tangent handle along its fixed axis           | Drag its dashed handle tip                                             |
| Close a path (two or more nodes)                                 | Click the first node                                                   |
| Close with a cusp                                                | Hold Shift when releasing on the first node                            |
| Close by merging the last node into the first                    | Drag the last node onto the first; Shift at release gives a cusp close |
| Change the selected point's type                                 | Corner / Smooth / Tangent in the floating palette                      |
| Convert a hovered or selected point to Corner / Smooth / Tangent | C / S / T                                                              |
| Show/hide handles                                                | D                                                                      |
| Release manually adjusted handles                                | R                                                                      |
| Load the original seven examples                                 | 1–7 or the example menu                                                |
| Finish an open path                                              | Enter or right-click                                                   |
| Clear                                                            | Esc or Clear                                                           |
| Undo                                                             | Cmd/Ctrl-Z or Undo                                                     |
| Redo                                                             | Cmd/Ctrl-Shift-Z, Ctrl-Y or Redo                                       |

Ctrl takes priority over Shift, as in the demo. A new click on empty canvas
after finishing or closing starts a new path. Undo restores the previous path.
Each complete drag is one undo step. Type conversions, closures, handle resets,
finishing, clearing and example loading are undoable. Drags finish at the release
position, including quick releases between mouse-move events. Cancelled gestures
roll back; unexpected pointer-capture loss keeps the edit at its last position.
History holds up to 100 edits; handle visibility is view state.
The last clicked point or handle stays selected after the pointer leaves the
canvas. The palette edits that point (or a selected handle's owning point),
shows its current type, and supports undo/redo. Selection clicks add no undo steps.

## Layout

- `bezigon-cpp/bezigon.h`, `bezigon-cpp/bezigon.cpp` — the two unmodified upstream 4.2.0 files used by the app.
- `bezigon-cpp/*.zip`, `bezigon-cpp/README.md` — retained original archives and source notes. The archives contain the older versions, native demos, upstream tests and reference documents.
- `wasm/bridge.cpp` — C ABI transport, reconstructing a temporary C++ path for each calculation. No GUI or history.
- `scripts/build-wasm.mjs` — compiles only the bridge and upstream `bezigon.cpp`; the Windows demo is excluded.
- `src/engine.ts` — typed memory transport to/from WASM.
- `src/editor.ts`, `src/history.ts` — TypeScript editor state, gestures and undo/redo.
- `src/handles.ts` — shared handle positions for rendering and hit testing, including dashed tips for collapsed Tangent handles.
- `src/render.ts`, `src/main.ts`, `src/style.css` — Canvas 2D rendering and responsive UI.
- `src/scenes.ts` — point positions/types from the original demo; handles still come from C++.

The bridge preserves closure mode, cusp state, manual-handle flags and offsets
across calls. Node conversion, closing, handle dragging, automatic handles and
Tangent axes are calculated by the upstream C++ library.

The upstream MIT notice ships as `public/BEZIGON-LICENSE.txt` and is copied to
the production output.

## Background

Bezigon appeared in FreeHand and Fontographer. The supplied code was written
by Taras Vynnychenko and published by Vira D. under MIT.

- [Inkscape discussion and source packages](https://gitlab.com/inkscape/inkscape/-/work_items/6476)
- [Bezigon & Freehand — Corel Vector Basics](https://www.youtube.com/watch?v=WxUwPI_V1rk)
- [Reviving the FreeHand Bezigon tool](https://www.youtube.com/watch?v=w3ieED1z4gM)
- [VectorStyler discussion](https://www.vectorstyler.com/forum/topic/4994/bezigon-tool)
