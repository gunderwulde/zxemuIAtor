// Coherencia de la tabla z80isa y de su uso por el ensamblador. El oráculo de bytes
// independiente está en reference.test.ts; aquí se comprueba la forma de la tabla
// (cobertura de opcodes, unicidad de codificaciones) y que cada entrada canónica se
// ensambla a su propia plantilla.
import { describe, expect, it } from "vitest";
import { Z80_ISA, OP_D, OP_E, OP_N, OP_NN, type IsaEntry } from "../../web/src/z80isa/index";
import { assemble } from "../../web/src/asm/index";

function literalPattern(e: IsaEntry): string {
  return e.template.map((t) => (t < 0x100 ? t.toString(16).padStart(2, "0") : "..")).join(" ");
}

function opcodesOf(prefix: string): Set<number> {
  return new Set(Z80_ISA.filter((e) => e.prefix === prefix).map((e) => e.opcode));
}

describe("z80isa: cobertura", () => {
  it("sin prefijo: los 256 opcodes salvo CB/DD/ED/FD", () => {
    const s = opcodesOf("");
    expect(s.size).toBe(252);
    for (const p of [0xcb, 0xdd, 0xed, 0xfd]) expect(s.has(p)).toBe(false);
  });
  it("CB, DDCB y FDCB: 256 opcodes cada una", () => {
    expect(opcodesOf("cb").size).toBe(256);
    expect(opcodesOf("ddcb").size).toBe(256);
    expect(opcodesOf("fdcb").size).toBe(256);
  });
  it("ED: 40-7F salvo 77/7F, y los 16 de bloque", () => {
    const s = opcodesOf("ed");
    expect(s.size).toBe(78);
    for (let op = 0x40; op < 0x80; op++) expect(s.has(op), op.toString(16)).toBe(op !== 0x77 && op !== 0x7f);
    for (const op of [0xa0, 0xa1, 0xa2, 0xa3, 0xa8, 0xab, 0xb0, 0xb3, 0xb8, 0xbb]) expect(s.has(op)).toBe(true);
  });
  it("DD y FD: mismos opcodes", () => {
    expect([...opcodesOf("dd")].sort()).toEqual([...opcodesOf("fd")].sort());
    // Young: 18 en x=0 (09 19 21-2E 34-36 39) + 38 LD (filas b,c,d,e,a con h/l/(hl): 15;
    // filas h y l: 16; fila (hl) sin HALT: 7) + 24 ALU + 5 (E1 E3 E5 E9 F9) = 85.
    expect(opcodesOf("dd").size).toBe(85);
  });
  it("cada patrón de bytes es único (lo necesita el desensamblador)", () => {
    const seen = new Map<string, string>();
    for (const e of Z80_ISA) {
      const k = literalPattern(e);
      expect(seen.get(k), `${k}: ${e.text} vs ${seen.get(k)}`).toBeUndefined();
      seen.set(k, e.text);
    }
  });
  it("cada codificación duplicada tiene una canónica con el mismo texto", () => {
    const canon = new Set(Z80_ISA.filter((e) => !e.dup).map((e) => e.text));
    const dups = Z80_ISA.filter((e) => e.dup);
    // neg x7, retn x6, im x5, ld (nn),hl / ld hl,(nn) por ED, bit n,(ix+d),r x 8x7 x2
    expect(dups.length).toBe(7 + 6 + 5 + 2 + 2 * 8 * 7);
    for (const d of dups) expect(canon.has(d.text), d.text).toBe(true);
  });
  it("longitudes", () => {
    for (const e of Z80_ISA) {
      let n = 0;
      for (const t of e.template) n += t === OP_NN ? 2 : 1;
      expect(e.length).toBe(n);
      expect(e.length).toBeLessThanOrEqual(4);
    }
  });
});

describe("z80isa: cada entrada canónica se ensambla a su plantilla", () => {
  const sample = (op: string) =>
    op === "n" ? "12h" : op === "nn" ? "1234h" : op === "(n)" ? "(12h)" : op === "(nn)" ? "(1234h)"
      : op === "rel" ? "$" : op.replace("+d)", "+5)");
  const entries = Z80_ISA.filter((e) => !e.dup);
  it("todas", () => {
    const failures: string[] = [];
    for (const e of entries) {
      const src = e.mnemonic + " " + e.operands.map(sample).join(",");
      const r = assemble(`\torg 8000h\n\t${src}\n`);
      const got = r.segments[0] ? [...r.segments[0].bytes] : [];
      const want: number[] = [];
      for (const t of e.template) {
        if (t < 0x100) want.push(t);
        else if (t === OP_N) want.push(0x12);
        else if (t === OP_NN) want.push(0x34, 0x12);
        else if (t === OP_D) want.push(0x05);
        else if (t === OP_E) want.push(0xfe);
      }
      if (r.errors.length || got.join() !== want.join()) failures.push(`${src}: ${got} != ${want} ${r.errors.map((x) => x.msg)}`);
    }
    expect(failures).toEqual([]);
    // 252 + 256 + 78 + 2·85 + 2·256 = 1268 codificaciones, 132 duplicadas.
    expect(Z80_ISA.length).toBe(1268);
    expect(entries.length).toBe(1136);
  });
});
