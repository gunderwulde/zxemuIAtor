// ULA-01 · tabla de contención (DOC §4 + REF tests/ref/contention.ts).
// Requiere: M1 (tabla de contención). No necesita CPU.
import { beforeAll, describe, expect, it } from "vitest";
import { memDelay, TSTATES_PER_FRAME } from "../../ref/contention";
import { Probe } from "../../util/probe";

describe("[M1] ULA-01 tabla de contención", () => {
  let p: Probe;
  beforeAll(async () => { p = await Probe.create(); });

  it("puntos fijos (TEST-PLAN ULA-01, DOC §4)", () => {
    // DOC §4: L(n) = 14335 + 224·n, patrón 6,5,4,3,2,1,0,0 en 128 T.
    const fixed: Array<[number, number]> = [
      [14334, 0], [14335, 6], [14336, 5], [14340, 1], [14341, 0], [14342, 0], [14343, 6],
      [14462, 0], [14463, 0], [57119, 6], [57119 + 128, 0], [69887, 0],
    ];
    const bad = fixed.filter(([t, d]) => p.x.zx_t_contention(t) !== d).map(([t, d]) => `T ${t}: ${p.x.zx_t_contention(t)} (esperado ${d})`);
    expect(bad).toEqual([]);
  });

  it("los 69 888 T coinciden con el modelo REF", () => {
    const bad: string[] = [];
    for (let t = 0; t < TSTATES_PER_FRAME; t++) {
      const got = p.x.zx_t_contention(t), exp = memDelay(t);
      if (got !== exp && bad.length < 10) bad.push(`T ${t}: ${got} (esperado ${exp})`);
    }
    expect(bad).toEqual([]);
  });

  it("margen tras el frame (instrucciones que cruzan 69 888): sin contención", () => {
    // REF: la ULA está en el borde superior del frame siguiente.
    for (let t = TSTATES_PER_FRAME; t < TSTATES_PER_FRAME + 64; t++) expect(p.x.zx_t_contention(t), `T ${t}`).toBe(0);
  });
});
