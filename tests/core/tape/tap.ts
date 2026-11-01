// Utilidades de cinta para los tests de M3: construcción de TAP y teclado.
import type { Core } from "../../../web/src/emu/core";

/** Bloque TAP: [len16][flag][datos][xor]. */
export function tapBlock(flag: number, data: ArrayLike<number>, checksum?: number): number[] {
  let x = flag;
  for (let i = 0; i < data.length; i++) x ^= data[i]!;
  const len = data.length + 2;
  return [len & 0xff, len >> 8, flag, ...Array.from(data), checksum ?? x];
}

/** Cabecera ROM de 17 bytes (tipo, nombre[10], longitud, p1, p2). */
export function header(type: number, name: string, len: number, p1: number, p2: number): number[] {
  const n = name.padEnd(10, " ").slice(0, 10);
  return [type, ...Array.from(n, (ch) => ch.charCodeAt(0)), len & 0xff, len >> 8, p1 & 0xff, p1 >> 8, p2 & 0xff, p2 >> 8];
}

export const tap = (...blocks: number[][]) => Uint8Array.from(blocks.flat());

/** ¿Hay CPU de verdad? (el stub de la fase 0 ejecuta todo como NOP). */
export function hasRealCpu(core: Core): boolean {
  core.x.zx_reset();
  core.x.zx_poke(0x8000, 0x3e); // LD A,0x42
  core.x.zx_poke(0x8001, 0x42);
  core.x.zx_set_pc(0x8000);
  core.x.zx_step();
  const ok = core.regs.get16("af") >> 8 === 0x42 && core.regs.get16("pc") === 0x8002;
  core.x.zx_reset();
  return ok;
}

// Matriz del teclado (docs §6): fila 0..7 = semifilas 0xFEFE..0x7FFE.
export const KEY = {
  J: [6, 3], P: [5, 0], ENTER: [6, 0], SYM: [7, 1], SPACE: [7, 0], CAPS: [0, 0],
} as const;

export function runFrames(core: Core, n: number) {
  for (let i = 0; i < n; i++) core.runFrame();
}

/** Pulsa una combinación durante unos frames y la suelta. */
export function press(core: Core, keys: (readonly [number, number])[], frames = 4) {
  for (const [r, b] of keys) core.x.zx_key(r, b, 1);
  runFrames(core, frames);
  for (const [r, b] of keys) core.x.zx_key(r, b, 0);
  runFrames(core, frames);
}

/** LOAD "" + ENTER en modo K: J = LOAD, SYM+P = ". */
export function typeLoad(core: Core) {
  press(core, [KEY.J]);
  press(core, [KEY.SYM, KEY.P]);
  press(core, [KEY.SYM, KEY.P]);
  press(core, [KEY.ENTER]);
}
