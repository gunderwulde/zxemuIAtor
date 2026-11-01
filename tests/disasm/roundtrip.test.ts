// Round-trip del desensamblador (PLAN.md D1, aceptación): ensamblar(desensamblar(bytes))
// == bytes. El oráculo son los propios bytes de entrada (no salen del código bajo prueba);
// el ensamblador (A1) está verificado aparte contra ZEXDOC/ZEXALL y z80test.
import { describe, expect, it } from "vitest";
import { assemble } from "../../web/src/asm";
import { disassemble, type DisasmLine } from "../../web/src/disasm";
import { rom48 } from "../util/wasm";

/** Ensambla un fuente y devuelve la imagen de 64 K (más qué bytes se escribieron). */
function image(src: string): { mem: Uint8Array; written: Uint8Array } {
  const r = assemble(src);
  const errs = r.errors.filter((e) => e.severity === "error");
  if (errs.length) {
    const lines = src.split("\n");
    throw new Error(errs.slice(0, 5).map((e) => `${e.line}: ${e.msg}: «${lines[e.line - 1]}»`).join("\n"));
  }
  const mem = new Uint8Array(65536), written = new Uint8Array(65536);
  for (const s of r.segments) {
    mem.set(s.bytes, s.addr);
    written.fill(1, s.addr, s.addr + s.bytes.length);
  }
  return { mem, written };
}

const hexs = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

/**
 * Coloca cada patrón en su propia dirección (separadas 8 bytes), los desensambla allí,
 * ensambla todos los textos de una vez (un ORG por instrucción) y compara byte a byte
 * los `len` bytes de cada una.
 */
function roundTrip(patterns: number[][], base = 0x8000, stride = 8): void {
  const mem = new Uint8Array(65536);
  const lines: DisasmLine[] = [];
  let src = "";
  patterns.forEach((p, i) => {
    const a = base + i * stride;
    mem.set(p, a);
    const l = disassemble(mem, a);
    lines.push(l);
    src += ` org ${a}\n ${l.text}\n`;
  });
  const { mem: out, written } = image(src);
  for (const l of lines) {
    const want = mem.subarray(l.addr, l.addr + l.len);
    const got = out.subarray(l.addr, l.addr + l.len);
    const all = written.subarray(l.addr, l.addr + l.len).every((w) => w === 1);
    if (!all || hexs(got) !== hexs(want)) {
      expect(`${hexs(got)} (escritos: ${all})`, `${hexs(want)} → «${l.text}»`).toBe(hexs(want));
    }
    // No escribe más allá de su longitud.
    expect(written[l.addr + l.len], `${hexs(want)} → «${l.text}» ocupa más de ${l.len}`).toBe(0);
  }
}

describe("round-trip ensamblar(desensamblar(x)) == x", () => {
  it("los 65 536 pares de 2 bytes (con dos bytes de cola variables)", () => {
    for (let b0 = 0; b0 < 256; b0++) {
      const pats: number[][] = [];
      for (let b1 = 0; b1 < 256; b1++) pats.push([b0, b1, (b0 * 7 + b1) & 0xff, (b1 * 13 + 3) & 0xff]);
      roundTrip(pats);
    }
  });

  it("DDCB/FDCB: los 256 opcodes con desplazamientos 00, 01, 7F, 80, FF", () => {
    for (const pre of [0xdd, 0xfd]) {
      for (const d of [0x00, 0x01, 0x7f, 0x80, 0xff]) {
        const pats: number[][] = [];
        for (let op = 0; op < 256; op++) pats.push([pre, 0xcb, d, op]);
        roundTrip(pats);
      }
    }
  });

  it("DD/FD/ED con todos los opcodes y operandos extremos (n, nn, d = 00, 7F, 80, FF)", () => {
    for (const pre of [0xdd, 0xfd, 0xed]) {
      for (const v of [0x00, 0x7f, 0x80, 0xff]) {
        const pats: number[][] = [];
        for (let op = 0; op < 256; op++) pats.push([pre, op, v, v ^ 0x5a]);
        roundTrip(pats);
      }
    }
  });

  it("saltos relativos en los bordes de 64 K (destino que da la vuelta → $±n)", () => {
    const pats: number[][] = [];
    for (const op of [0x10, 0x18, 0x20, 0x28, 0x30, 0x38]) for (const e of [0x00, 0x7f, 0x80, 0xfe]) pats.push([op, e]);
    // Al principio de la memoria (destinos negativos) y al final (destinos > FFFFh).
    roundTrip(pats, 0x0000, 4);
    roundTrip(pats, 0x10000 - pats.length * 4, 4);
  });

  /** Barrido lineal: desensambla `mem[from..to)` y reensambla el listado completo. */
  function sweep(mem: Uint8Array, from: number, to: number): number {
    let src = ` org ${from}\n`, a = from, n = 0;
    while (a < to) {
      const l = disassemble(mem, a);
      src += ` ${l.text}\n`;
      a += l.len;
      n++;
    }
    const { mem: out } = image(src);
    expect(hexs(out.subarray(from, to)) === hexs(mem.subarray(from, to))).toBe(true);
    return n;
  }

  it("la ROM 48K entera en barrido lineal", () => {
    const mem = new Uint8Array(65536);
    mem.set(rom48());
    expect(sweep(mem, 0, 0x4000)).toBeGreaterThan(5000);
  });

  it("64 K de bytes pseudoaleatorios en barrido lineal (semilla fija)", () => {
    const mem = new Uint8Array(65536);
    let s = 0x2545f491;
    for (let i = 0; i < mem.length; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      mem[i] = s & 0xff;
    }
    // Hasta FFF0h: la última instrucción no debe salirse de la memoria.
    sweep(mem, 0, 0xfff0);
  });
});
