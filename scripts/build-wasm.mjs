import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'bezigon-cpp');
const output = join(root, 'public/wasm');
mkdirSync(output, { recursive: true });
// Compile in isolation so overlapping dev/build/test commands never share the
// compiler's intermediate WASM file. Publish the matching pair after success.
const staging = mkdtempSync(join(tmpdir(), 'bezigon-wasm-'));
const result = spawnSync(
  process.env.EMCC || 'emcc',
  [
    join(root, 'wasm/bridge.cpp'),
    join(source, 'bezigon.cpp'),
    '-I',
    source,
    '-std=c++11',
    '-O3',
    '--no-entry',
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sEXPORT_NAME=createBezigon',
    '-sENVIRONMENT=web,node',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sFILESYSTEM=0',
    '-sEXPORTED_FUNCTIONS=["_malloc","_free","_bg_run"]',
    '-sEXPORTED_RUNTIME_METHODS=["HEAPF64"]',
    '-o',
    join(staging, 'bezigon.mjs'),
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, EM_CACHE: process.env.EM_CACHE || join(root, '.emscripten-cache') },
  },
);
if (result.error)
  console.error(
    'Emscripten is required. Install emsdk or `brew install emscripten`, then ensure emcc is on PATH.',
    result.error.message,
  );
if (result.status === 0) {
  for (const file of ['bezigon.wasm', 'bezigon.mjs'])
    copyFileSync(join(staging, file), join(output, file));
}
rmSync(staging, { recursive: true, force: true });
process.exit(result.status ?? 1);
