// Utilidades compartidas por los scripts de ingeniería inversa de Sootland.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Core, STOP } from "../../web/src/emu/core";
import { instantiate, ROOT, rom48 } from "../../tests/util/wasm";
import { KEY, press, runFrames, typeLoad } from "../../tests/core/tape/tap";

export const DIR = join(ROOT, "tests", "fixtures-local", "sootland");
export const WORK = join(DIR, "work");
mkdirSync(WORK, { recursive: true });
export { KEY, STOP, press, runFrames, typeLoad };

export function tzxToTap(b: Uint8Array): number[] {
  const out: number[] = [];
  for (let p = 10; p < b.length;) {
    const id = b[p]!;
    if (id === 0x10) {
      const n = b[p + 3]! | (b[p + 4]! << 8);
      out.push(n & 0xff, n >> 8, ...b.subarray(p + 5, p + 5 + n));
      p += 5 + n;
    } else if (id === 0x30) p += 2 + b[p + 1]!;
    else if (id === 0x32) p += 3 + (b[p + 1]! | (b[p + 2]! << 8));
    else throw new Error(`bloque TZX 0x${id.toString(16)}`);
  }
  return out;
}

/** Bloques de un TAP (flag + datos + checksum, sin la longitud). */
export function tapBlocks(t: number[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let p = 0; p < t.length;) {
    const n = t[p]! | (t[p + 1]! << 8);
    out.push(Uint8Array.from(t.slice(p + 2, p + 2 + n)));
    p += 2 + n;
  }
  return out;
}

export const readTzx =(n: string) => new Uint8Array(readFileSync(join(DIR, n)));
export const save = (n: string, d: Uint8Array) => writeFileSync(join(WORK, n), d);
export const have = (n: string) => existsSync(join(WORK, n));

export async function newCore(): Promise<Core> {
  const core = new Core(await instantiate("core-probe"));
  core.loadRom(rom48());
  return core;
}

export function bootSootland(core: Core): void {
  const tape = Uint8Array.from([...tzxToTap(readTzx("Sootland - Side 1.tzx")), ...tzxToTap(readTzx("Sootland - Side 2.tzx"))]);
  core.x.zx_reset();
  runFrames(core, 150);
  if (core.loadTap(tape) !== 0) throw new Error("loadTap");
  typeLoad(core);
}

import { deflateSync } from "node:zlib";
/** RGBA → PNG (para mirar capturas durante el análisis). */
export function png(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8Array {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
export function shot(core: Core, name: string, scale = 1): void {
  const fb = core.framebuffer();
  if (scale === 1) { save(name, png(fb, 352, 296)); return; }
  const w = 352 * scale, h = 296 * scale, o = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y / scale | 0) * 352 + (x / scale | 0)) * 4; o.set(fb.subarray(s, s + 4), (y * w + x) * 4); }
  save(name, png(o, w, h));
}
