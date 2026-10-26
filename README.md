# Bezigon

A FreeHand-inspired curve playground. Bezigon 4.2.0 C++ handles the calculations
through WebAssembly; Vite, TypeScript and Canvas handle the interface.

## Run

Requires Node.js 22.18+ and [Emscripten](https://emscripten.org/docs/getting_started/downloads.html)
with `emcc` on your PATH (`brew install emscripten` on macOS).

```sh
npm install
npm run dev
```

Open the URL printed by Vite. WASM compiles automatically on dev/build.
After editing C++, run `npm run wasm` and reload.

## Commands

```sh
npm run build        # production build in dist/
npm run preview      # preview the build
npm test             # WASM and editor tests
npm run format       # format project files
npm run format:check # check formatting
```

For browser tests, run `npx playwright install chromium` once, then `npm run test:browser`.

Original C++ by Taras V, Vivek R. ([MIT](bezigon-cpp/LICENSE.md)).
[Source discussion](https://gitlab.com/inkscape/inkscape/-/work_items/6476) ·
[Bezigon explanation](https://www.youtube.com/watch?v=w3ieED1z4gM).
