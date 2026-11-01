// L1: beep(hz, ms) medido en el log del beeper del núcleo real (core-probe).
// Oráculo: periodo = 3 500 000 / hz T (docs §1: reloj de 3,5 MHz), número de periodos =
// hz·ms/1000, EAR = bit 4 de OUT (FEh) (docs §6, §12). Tolerancia ±1 %.
import { describe, expect, it } from "vitest";
import { TSTATES_PER_FRAME as F } from "../../web/src/emu/core";
import { call, program, run, type Run } from "./harness";

/** Corre hasta `fin` y devuelve los cambios del altavoz con T absoluto. */
function beeperUntilFin(r: Run, maxFrames = 400): { t: number; level: number }[] {
  const p = r.p;
  const ev = new Map<number, number>();
  let frame = 0;
  for (let f = 0; f < maxFrames && !r.atFin(); f++) {
    // zx_t_run_until para justo al llegar al final del frame, antes de cerrarlo: el
    // log todavía tiene todo el frame. Lo que pasa de 69 888 T se arrastra al siguiente
    // (con T − 69 888), por eso se indexa por T absoluto y se deduplica.
    if (p.t >= F) frame++;
    p.x.zx_t_run_until(p.t >= F ? 2 * F : F);
    for (const e of p.beeperLog()) ev.set(frame * F + e.t, e.level);
  }
  if (!r.atFin()) throw new Error("no llega a fin");
  return [...ev].sort((a, b) => a[0] - b[0]).map(([t, level]) => ({ t, level }));
}

const EAR = 2; // código del log: bit 1 = EAR, bit 0 = MIC

async function beep(hz: number, ms: number) {
  const r = await run(program(call("beep", hz, ms)), { run: false });
  return { r, log: beeperUntilFin(r) };
}

function periods(log: { t: number; level: number }[]): number[] {
  const rises = log.filter((e) => e.level === EAR).map((e) => e.t);
  return rises.slice(1).map((t, i) => t - rises[i]!);
}

describe("beep", () => {
  it("beep(440, 100): 44 periodos de 7955 T ±1 % y acaba en silencio", async () => {
    const { r, log } = await beep(440, 100);
    expect(log.length).toBe(88);
    expect(log.filter((e) => e.level === EAR).length).toBe(44);
    expect(log.every((e) => e.level === EAR || e.level === 0)).toBe(true);
    expect(log[log.length - 1]!.level).toBe(0);
    const ps = periods(log);
    for (const p of ps) {
      expect(p).toBeGreaterThan(7955 * 0.99);
      expect(p).toBeLessThan(7955 * 1.01);
    }
    // Duración total ≈ 100 ms = 350 000 T (±1 %).
    const span = log[log.length - 1]!.t - log[0]!.t;
    expect(span).toBeGreaterThan(350000 * 0.99 - 7955);
    expect(span).toBeLessThan(350000 * 1.01);
    // Interrupciones repuestas (BASIC las tenía activas) e IX intacto.
    expect(r.p.regs.get8("iff1")).toBe(1);
    expect(r.peek16(r.sym("ix_out"))).toBe(0xa55a);
  });

  it("beep(1000, 50): 50 periodos de 3500 T ±1 %", async () => {
    const { log } = await beep(1000, 50);
    expect(log.length).toBe(100);
    for (const p of periods(log)) {
      expect(p).toBeGreaterThan(3500 * 0.99);
      expect(p).toBeLessThan(3500 * 1.01);
    }
  });

  it("beep(110, 200): 22 periodos de 31818 T ±1 %", async () => {
    const { log } = await beep(110, 200);
    expect(log.length).toBe(44);
    for (const p of periods(log)) {
      expect(p).toBeGreaterThan(31818 * 0.99);
      expect(p).toBeLessThan(31818 * 1.01);
    }
  });

  it("hz = 0 o ms = 0 no suenan", async () => {
    expect((await beep(0, 100)).log).toEqual([]);
    expect((await beep(440, 0)).log).toEqual([]);
  });
});
