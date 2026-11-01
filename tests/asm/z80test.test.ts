// Oráculo: fuentes de z80test 1.2a (Patrik Rak, sintaxis sjasm 0.39) frente a los .tap
// publicados en el mismo zip. El último bloque de datos del TAP (flag FFh) es el
// binario cargado en 8000h; se compara entero, byte a byte.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemble } from "../../web/src/asm/index";

const DIR = resolve(__dirname, "../fixtures/z80test/z80test-1.2a");
const PROGS = ["z80full", "z80flags", "z80doc", "z80docflags", "z80ccf", "z80memptr", "z80ccfscr"];

function tapBlocks(tap: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i + 2 <= tap.length; ) {
    const n = tap[i]! | (tap[i + 1]! << 8);
    out.push(tap.subarray(i + 2, i + 2 + n));
    i += 2 + n;
  }
  return out;
}

describe.skipIf(!existsSync(DIR))("z80test 1.2a", () => {
  it.each(PROGS)("%s ensambla idéntico al .tap", (name) => {
    const include = (p: string) => readFileSync(resolve(DIR, "src", p), "latin1");
    const r = assemble(include(`${name}.asm`), { org: 0, include });
    expect(r.errors.filter((e) => e.severity === "error")).toEqual([]);
    const blocks = tapBlocks(new Uint8Array(readFileSync(resolve(DIR, `${name}.tap`))));
    const header = blocks[blocks.length - 2]!;
    const data = blocks[blocks.length - 1]!;
    expect(header[0]).toBe(0);
    expect(data[0]).toBe(0xff);
    const start = header[14]! | (header[15]! << 8);
    const payload = data.subarray(1, data.length - 1);
    expect(r.segments.length).toBe(1);
    expect(r.segments[0]!.addr).toBe(start);
    expect(r.segments[0]!.bytes.length).toBe(payload.length);
    let firstDiff = -1;
    for (let i = 0; i < payload.length; i++) if (payload[i] !== r.segments[0]!.bytes[i]) { firstDiff = i; break; }
    expect(firstDiff).toBe(-1);
  });
});
