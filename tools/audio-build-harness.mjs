// Compila core/src/audio_test_harness.c → <ZX_BUILD_DIR|build/wasm>/audio-harness.wasm
// con los mismos flags que tools/build-core.mjs (+ ZX_DEBUG para los asserts).
// Lo invocan los tests de tests/core/audio antes de cargar el harness; también se puede
// ejecutar a mano: node tools/audio-build-harness.mjs
//   AUDIO_HARNESS_SRC=<fichero .c>  compila otro harness (p. ej. una copia del harness
//   junto a una copia mutada de audio.c) para comprobar que los tests fallan
//   (docs/TEST-PLAN.md §7).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, process.env.ZX_BUILD_DIR ?? join("build", "wasm"));
const exe = process.platform === "win32" ? "clang.exe" : "clang";
const dirs = [process.env.LLVM_BIN, process.platform === "win32" ? "C:\\Program Files\\LLVM\\bin" : null];
const clang = dirs.map((d) => d && join(d, exe)).find((p) => p && existsSync(p)) ?? exe;

mkdirSync(out, { recursive: true });
const dst = join(out, "audio-harness.wasm");
execFileSync(clang, [
  "--target=wasm32", "-std=c99", "-ffreestanding", "-nostdlib", "-mbulk-memory",
  "-Wall", "-Wextra", "-Werror", "-Wno-unused-function", "-O2", "-DZX_DEBUG",
  "-Wl,--no-entry", "-Wl,--stack-first", "-Wl,-z,stack-size=65536",
  "-I", join(root, "core", "src"),
  process.env.AUDIO_HARNESS_SRC ?? join(root, "core", "src", "audio_test_harness.c"),
  "-o", dst,
], { stdio: "inherit" });
console.log(dst);
