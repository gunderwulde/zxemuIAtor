// ULA-03 (contención de E/S), ULA-04 (fuera de la ventana) y ULA-05 (HALT) ·
// DOC §4/§5 + REF tests/ref/contention.ts.
// Requiere: C1 (CPU) + M1 (contención de memoria y E/S). Fallan hasta que lleguen.
//
// Programas: bytes de opcode escritos a mano (nunca el ensamblador A1). Cada test pone
// el código, los registros y el T de inicio con los hooks, ejecuta UNA instrucción con
// zx_step con la INT de la ULA desactivada y compara los T consumidos con el REF.
import { beforeAll, describe, expect, it } from "vitest";
import { type BusCycle, lineStart, memDelay, PATTERNS, runPattern, TSTATES_PER_FRAME } from "../../ref/contention";
import { Probe } from "../../util/probe";

const hex = (v: number) => "0x" + v.toString(16).padStart(4, "0");

interface IoCase {
  name: string;
  /** Bytes en pc. */
  code: number[];
  /** Registros en función del puerto. */
  regs: (port: number) => Record<string, number>;
  /** Patrón de bus REF (pc, puerto). */
  pattern: (pc: number, port: number) => BusCycle[];
  /** T sin contención antes del ciclo de E/S (para colocar el ciclo en la fase k). */
  pre: number;
}

// I = 0 → la dirección IR de INI/OUTI (I·256+R) está fuera de 0x4000–0x7FFF.
const IO_CASES: IoCase[] = [
  // IN A,(n) = DB n: puerto = A·256 + n
  { name: "IN A,(n)", code: [], regs: (p) => ({ af: (p & 0xff00) | 0x00 }), pattern: (pc, p) => PATTERNS.inAN(pc, p), pre: 7 },
  // IN A,(C) = ED 78
  { name: "IN A,(C)", code: [0xed, 0x78], regs: (p) => ({ bc: p }), pattern: (pc, p) => PATTERNS.inRC(pc, p), pre: 8 },
  // OUT (n),A = D3 n
  { name: "OUT (n),A", code: [], regs: (p) => ({ af: (p & 0xff00) | 0x00 }), pattern: (pc, p) => PATTERNS.outNA(pc, p), pre: 7 },
  // OUT (C),A = ED 79
  { name: "OUT (C),A", code: [0xed, 0x79], regs: (p) => ({ bc: p, af: 0x0700 }), pattern: (pc, p) => PATTERNS.outCR(pc, p), pre: 8 },
  // INI = ED A2: lee de BC (B antes de decrementar) y escribe en HL
  { name: "INI", code: [0xed, 0xa2], regs: (p) => ({ bc: p, hl: 0x9000, i: 0 }), pattern: (pc, p) => PATTERNS.ini(pc, 0x0000, p, 0x9000), pre: 9 },
  // OUTI = ED A3: B se decrementa ANTES de poner BC en el bus → B inicial = alto + 1
  { name: "OUTI", code: [0xed, 0xa3], regs: (p) => ({ bc: (p + 0x100) & 0xffff, hl: 0x9000, i: 0 }), pattern: (pc, p) => PATTERNS.outi(pc, 0x0000, 0x9000, p), pre: 12 },
];

// TEST-PLAN ULA-03.
const PORTS = [0x00fe, 0x40fe, 0x00ff, 0x40ff, 0x7ffe, 0x80ff];

describe("[C1+M1] ULA-03 contención de E/S", () => {
  let p: Probe;
  beforeAll(async () => {
    p = await Probe.create();
    p.x.zx_t_set_int_enabled(0);
  });

  for (const c of IO_CASES) {
    it(c.name, () => {
      const bad: string[] = [];
      for (const pc of [0x8000, 0x6000]) { // código en RAM libre y en RAM contendida
        for (const port of PORTS) {
          const code = c.code.length ? c.code : [c.name.startsWith("IN") ? 0xdb : 0xd3, port & 0xff];
          for (let k = -2; k <= 9; k++) {
            const t0 = lineStart(10) + k - c.pre;
            p.poke(pc, code);
            p.setRegs({ pc, sp: 0xf000, iff1: 0, iff2: 0, ...c.regs(port) });
            p.t = t0;
            const got = p.step();
            const exp = runPattern(t0, c.pattern(pc, port)).end - t0;
            if (got !== exp) bad.push(`pc ${hex(pc)} puerto ${hex(port)} T0 L(10)${k - c.pre >= 0 ? "+" : ""}${k - c.pre}: ${got} T (esperado ${exp})`);
          }
        }
      }
      expect(bad.slice(0, 8)).toEqual([]);
    });
  }
});

describe("[C1+M1] ULA-04 fuera de la ventana de contención: cero retardo", () => {
  let p: Probe;
  beforeAll(async () => {
    p = await Probe.create();
    p.x.zx_t_set_int_enabled(0);
  });

  // DOC (manual Zilog): LD A,(HL) = 7 T, INC (HL) = 11 T sin contención.
  const instrs = [
    { name: "LD A,(HL)", code: [0x7e], base: 7 },
    { name: "INC (HL)", code: [0x34], base: 11 },
  ];
  const where = [
    { name: "borde superior", t: 1000, pc: 0x6000, hl: 0x4000 },
    { name: "borde inferior", t: lineStart(191) + 224 * 2, pc: 0x6000, hl: 0x4000 },
    { name: "borde lateral (offset ≥ 128)", t: lineStart(50) + 130, pc: 0x6000, hl: 0x4000 },
    { name: "en ventana pero en 0x8000+", t: lineStart(50), pc: 0x8000, hl: 0x9000 },
  ];
  for (const w of where) {
    it(w.name, () => {
      for (const ins of instrs) {
        // El REF debe confirmar que el caso está fuera de la ventana (si no, el test está mal).
        const ref = runPattern(w.t, ins.name === "INC (HL)" ? PATTERNS.incHL(w.pc, w.hl) : PATTERNS.ldRHL(w.pc, w.hl)).end - w.t;
        expect(ref, "autocomprobación REF").toBe(ins.base);
        p.poke(w.pc, ins.code);
        p.setRegs({ pc: w.pc, hl: w.hl, iff1: 0 });
        p.t = w.t;
        expect(p.step(), ins.name).toBe(ins.base);
      }
    });
  }
});

describe("[C1+M1] ULA-05 HALT en RAM contendida", () => {
  it("cada M1 repetido sufre contención; la INT siguiente se acepta en el T del REF", async () => {
    const bad: string[] = [];
    for (let k = 0; k < 8; k++) {
      const p = await Probe.create();
      const HALT_AT = 0x6000;
      p.poke(HALT_AT, [0x76]); // HALT
      p.setRegs({ pc: HALT_AT, sp: 0x9000, iff1: 1, iff2: 1, im: 1 });
      const t0 = lineStart(100) + k;
      p.t = t0;
      // REF: HALT (pc:4) y luego M1 de 4 T sobre la dirección siguiente (DOC §2), todos
      // contendidos (0x6000/0x6001), hasta el primer límite ≥ 69 888.
      let t = t0 + memDelay(t0) + 4;
      while (t < TSTATES_PER_FRAME) t += memDelay(t) + 4;
      const excess = t - TSTATES_PER_FRAME;
      p.runFrame();
      if (p.t !== excess) bad.push(`k=${k}: T tras el frame ${p.t} (esperado ${excess})`);
      // INT IM1 (DOC §2): 13 T, PC = 0x0038, en la pila la dirección tras el HALT.
      const used = p.step();
      const sp = p.regs.get16("sp");
      const ret = p.ram()[sp]! | (p.ram()[sp + 1]! << 8);
      if (used !== 13 || p.regs.get16("pc") !== 0x0038 || ret !== HALT_AT + 1 || p.regs.get8("halted") !== 0)
        bad.push(`k=${k}: aceptación ${used} T, pc ${hex(p.regs.get16("pc"))}, ret ${hex(ret)}, halted ${p.regs.get8("halted")}`);
    }
    expect(bad).toEqual([]);
  });
});
