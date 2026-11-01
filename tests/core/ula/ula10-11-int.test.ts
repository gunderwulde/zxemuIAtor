// ULA-10 (interrupción de la ULA) y ULA-11 (exceso de frame) · DOC §1, §2.
// Requiere: C1 (CPU, aceptación de INT) + M1 (bucle de frame, ventana de /INT).
//
// Convención (docs §2, resuelta con Fuse z80/z80.c z80_interrupt): la INT se acepta en
// un límite de instrucción si IFF1 = 1, no acaba de ejecutarse EI y el T del límite es
// < 32 (interrupt_length = 32 de libspectrum timings.c para el 48K).
import { describe, expect, it } from "vitest";
import { TSTATES_PER_FRAME } from "../../ref/contention";
import { Probe } from "../../util/probe";

/** Máquina con NOPs en 0x8000 (RAM libre), IM1, SP en 0x9000. */
async function machine(regs: Record<string, number | undefined> = {}): Promise<Probe> {
  const p = await Probe.create();
  p.setRegs({ pc: 0x8000, sp: 0x9000, im: 1, iff1: 1, iff2: 1, ...regs });
  return p;
}

const accepted = (p: Probe) => p.regs.get16("pc") === 0x0038;

describe("[C1+M1] ULA-10 interrupción de la ULA", () => {
  it("límite de instrucción en T 31 con IFF1=1 → INT aceptada (13 T)", async () => {
    const p = await machine();
    p.t = 31;
    expect(p.step()).toBe(13); // DOC §2: IM1 = 13 T
    expect(accepted(p)).toBe(true);
    expect(p.regs.get8("iff1")).toBe(0);
  });

  it("límite en T 32 → INT perdida (se ejecuta el NOP)", async () => {
    const p = await machine();
    p.t = 32;
    expect(p.step()).toBe(4);
    expect(p.regs.get16("pc")).toBe(0x8001);
  });

  it("DI todo el frame, EI en T 20 + NOP → aceptada tras el NOP (T 28 < 32)", async () => {
    const p = await machine({ iff1: 0, iff2: 0 });
    p.poke(0x8000, [0xfb, 0x00, 0x00]); // EI; NOP; NOP
    p.t = 20;
    p.step(); // EI → T 24
    expect(accepted(p)).toBe(false);
    p.step(); // NOP → T 28 (DOC §2: no se acepta hasta después de la siguiente a EI)
    expect(accepted(p)).toBe(false);
    expect(p.t).toBe(28);
    expect(p.step()).toBe(13);
    expect(accepted(p)).toBe(true);
  });

  it("EI en T 30 + instrucción de 4 T → INT perdida", async () => {
    const p = await machine({ iff1: 0, iff2: 0 });
    p.poke(0x8000, [0xfb, 0x00, 0x00]);
    p.t = 30;
    p.step(); // EI → 34 (no se puede aceptar justo tras EI)
    p.step(); // NOP → 38 ≥ 32
    p.step(); // NOP
    expect(p.regs.get16("pc")).toBe(0x8003);
  });

  it("EX (SP),IX (23 T) que cruza el final del frame: el exceso retrasa la aceptación", async () => {
    const p = await machine();
    p.poke(0x8000, [0xdd, 0xe3]); // EX (SP),IX: pc:4 pc+1:4 sp:3 sp+1:3 sp+1:1 sp+1(w):3 sp(w):3 sp:1×2 = 23 T
    p.t = TSTATES_PER_FRAME - 10;
    expect(p.runFrame()).toBe(0);
    expect(p.x.zx_frame_count()).toBe(1);
    expect(p.t).toBe(13); // 69878 + 23 − 69888
    expect(p.step()).toBe(13);
    expect(accepted(p)).toBe(true);
    expect(p.t).toBe(26);
  });

  it("50 frames de JP nn (10 T): T total = 50 × 69 888 + exceso final", async () => {
    // JP 0x8000 en 0x8000 → bucle de 10 T sin contención. INT desactivada.
    const p = await machine({ iff1: 0, iff2: 0 });
    p.x.zx_t_set_int_enabled(0);
    p.poke(0x8000, [0xc3, 0x00, 0x80]);
    p.t = 0;
    for (let k = 1; k <= 50; k++) {
      p.runFrame();
      // El frame k acaba en el primer múltiplo de 10 ≥ 69 888·k.
      const total = Math.ceil((TSTATES_PER_FRAME * k) / 10) * 10;
      expect(p.t, `frame ${k}`).toBe(total - TSTATES_PER_FRAME * k);
    }
    expect(p.x.zx_frame_count()).toBe(50);
  });
});

describe("[C1+M1+ROM] ULA-10 FRAMES (23672) con la ROM", () => {
  it("+1 por frame", async () => {
    const p = await Probe.create();
    for (let i = 0; i < 150; i++) p.runFrame(); // arranque de la ROM
    const frames = () => p.ram()[23672]! | (p.ram()[23673]! << 8) | (p.ram()[23674]! << 16);
    const f0 = frames();
    const seen: number[] = [];
    for (let i = 0; i < 50; i++) {
      p.runFrame();
      seen.push(frames() - f0);
    }
    expect(seen).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
});

describe("[C1+M1] ULA-11 exceso de frame", () => {
  // DOC (manual Zilog): NOP 4 T; ADD HL,BC 11 T; LDIR repitiendo 21 T; EX (SP),IX 23 T.
  const cases = [
    { name: "NOP (4 T)", code: [0x00], len: 4, regs: {} },
    { name: "ADD HL,BC (11 T)", code: [0x09], len: 11, regs: {} },
    { name: "LDIR que repite (21 T)", code: [0xed, 0xb0], len: 21, regs: { hl: 0x9000, de: 0xa000, bc: 0x0010 } },
    { name: "EX (SP),IX (23 T)", code: [0xdd, 0xe3], len: 23, regs: {} },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      for (const before of [1, 2, c.len - 1, c.len]) {
        const p = await machine({ iff1: 0, iff2: 0, ...c.regs });
        p.x.zx_t_set_int_enabled(0);
        p.poke(0x8000, c.code);
        p.t = TSTATES_PER_FRAME - before;
        p.runFrame();
        // zx_run_frame termina en el primer límite ≥ 69 888; el siguiente frame empieza en t − 69 888.
        expect(p.x.zx_frame_count(), `empieza ${before} T antes`).toBe(1);
        expect(p.t, `empieza ${before} T antes`).toBe(c.len - before);
      }
    });
  }
});
