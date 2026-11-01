// Utilidades de los tests de M1: instancia core-probe.wasm (ABI real) y compila/instancia
// m1-harness.wasm (zx48.c con los ciclos de bus expuestos, ver m1_harness.c).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Core } from "../../../web/src/emu/core";
import { instantiate, ROOT, WASM_DIR } from "../../util/wasm";

export const FRAME = 69888;
export const LINE = 224;
export const FB_W = 352;
export const FB_H = 296;

/** Exports de core-probe.wasm que usan estos tests (zx.h, sección ZX_TEST_HOOKS). */
export interface Probe {
  zx_t_set_tstate(t: number): void;
  zx_t_contention(t: number): number;
  zx_t_run_until(t: number): number;
  zx_t_set_int_enabled(on: number): void;
  zx_t_buslog_enable(on: number): void;
  zx_t_buslog(): number;
  zx_t_buslog_len(): number;
}

export interface Harness extends Probe {
  h_in(port: number): number;
  h_out(port: number, v: number): void;
  h_read(a: number): number;
  h_write(a: number, v: number): void;
  h_end_frame(): void;
}

export async function probe(): Promise<{ core: Core; x: Probe & Core["x"] }> {
  const core = new Core(await instantiate("core-probe"));
  return { core, x: core.x as unknown as Probe & Core["x"] };
}

function clang(): string {
  const exe = process.platform === "win32" ? "clang.exe" : "clang";
  for (const d of [process.env.LLVM_BIN, process.platform === "win32" ? "C:\\Program Files\\LLVM\\bin" : null])
    if (d && existsSync(join(d, exe))) return join(d, exe);
  return exe;
}

let harnessBytes: Buffer<ArrayBuffer> | null = null;

/** Compila m1-harness.wasm (una vez por proceso) con los flags de tools/build-core.mjs. */
function buildHarness(): Buffer<ArrayBuffer> {
  if (harnessBytes) return harnessBytes;
  const src = join(ROOT, "core", "src");
  mkdirSync(WASM_DIR, { recursive: true });
  const out = join(WASM_DIR, "m1-harness.wasm");
  execFileSync(clang(), [
    "--target=wasm32", "-std=c99", "-ffreestanding", "-nostdlib", "-mbulk-memory",
    "-Wall", "-Wextra", "-Werror", "-Wno-unused-function", "-O2",
    "-DZX_TEST_HOOKS", "-DZX_DEBUG",
    "-Wl,--no-entry", "-Wl,--stack-first", "-Wl,-z,stack-size=65536",
    join(ROOT, "tests", "core", "machine", "m1_harness.c"),
    ...["video.c", "audio.c", "tape.c", "snap.c", "debug.c"].map((f) => join(src, f)),
    "-o", out,
  ], { stdio: "inherit" });
  harnessBytes = readFileSync(out);
  return harnessBytes;
}

export async function harness(): Promise<{ core: Core; x: Harness & Core["x"] }> {
  const { instance } = await WebAssembly.instantiate(buildHarness(), {});
  const core = new Core(instance);
  return { core, x: core.x as unknown as Harness & Core["x"] };
}

export const EV = { MC: 0, MR: 1, MW: 2, PR: 3, PW: 4, PC: 5 } as const;
export interface Ev { t: number; addr: number; kind: number; value: number }

export function buslog(core: Core): Ev[] {
  const x = core.x as unknown as Probe;
  const n = x.zx_t_buslog_len();
  const dv = new DataView(core.x.memory.buffer, x.zx_t_buslog(), n * 8);
  const out: Ev[] = [];
  for (let i = 0; i < n; i++)
    out.push({ t: dv.getUint32(i * 8, true), addr: dv.getUint16(i * 8 + 4, true), kind: dv.getUint8(i * 8 + 6), value: dv.getUint8(i * 8 + 7) });
  return out;
}

/** Píxel RGBA del framebuffer como 0xRRGGBB. */
export function pixel(core: Core, x: number, y: number): number {
  const fb = core.framebuffer();
  const i = (y * FB_W + x) * 4;
  return (fb[i]! << 16) | (fb[i + 1]! << 8) | fb[i + 2]!;
}

/** Paleta de docs §3 (GRB, normal 0xD7, BRIGHT 0xFF), como 0xRRGGBB. Oráculo DOC. */
export function color(index: number, bright = false): number {
  const v = bright ? 0xff : 0xd7;
  return ((index & 2 ? v : 0) << 16) | ((index & 4 ? v : 0) << 8) | (index & 1 ? v : 0);
}

/** Modelo DOC de la contención (docs §4, TEST-PLAN ULA-01). */
export function refContention(t: number): number {
  const d = t - 14335;
  if (d < 0) return 0;
  const line = Math.floor(d / LINE), o = d % LINE;
  if (line >= 192 || o >= 128) return 0;
  return [6, 5, 4, 3, 2, 1, 0, 0][o % 8]!;
}

/** Dirección de bitmap de (columna en bytes, línea) según docs §3. */
export function pixAddr(x: number, y: number): number {
  return 0x4000 | ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | x;
}
export function attrAddr(x: number, y: number): number {
  return 0x5800 + (y >> 3) * 32 + x;
}
