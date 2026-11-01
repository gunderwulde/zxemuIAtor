// Bench del núcleo: arranca la ROM y ejecuta N frames; imprime la mediana de varias
// rondas en ms/frame y el múltiplo de tiempo real. P1 (PLAN.md) lo amplía.
//
// Uso: node tools/bench.mjs [frames=3000] [rondas=5]   (ZX_BUILD_DIR elige el core.wasm)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const frames = Number(process.argv[2] ?? 3000);
const rounds = Number(process.argv[3] ?? 5);
const FRAME_MS = (1000 * 69888) / 3_500_000;

const wasm = readFileSync(join(root, process.env.ZX_BUILD_DIR ?? join("build", "wasm"), "core.wasm"));
const rom = readFileSync(join(root, "rom", "48.rom"));
const { instance } = await WebAssembly.instantiate(wasm, {});
const x = instance.exports;

const times = [];
for (let r = 0; r < rounds; r++) {
  x.zx_init();
  new Uint8Array(x.memory.buffer, x.zx_io_buffer(), rom.length).set(rom);
  x.zx_load_rom(rom.length);
  x.zx_reset();
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) x.zx_run_frame();
  times.push((performance.now() - t0) / frames);
}
times.sort((a, b) => a - b);
const med = times[rounds >> 1];
console.log(`${frames} frames × ${rounds} rondas: mediana ${med.toFixed(4)} ms/frame, ${(FRAME_MS / med).toFixed(1)}× tiempo real`);
