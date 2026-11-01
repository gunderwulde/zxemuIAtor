// ULA-01 (tabla), ULA-04 (fuera de ventana) y contención de M1 con NOPs, sobre
// core-probe.wasm. Oráculo DOC: docs/zx48-hardware.md §4 (= Fuse spectrum.c,
// contend_delay_common con patrón 65432100). La CPU puede seguir siendo el stub de
// fase 0 (todo NOP): un NOP es un único M1 de 4 T, bus_read(pc, 4), igual en la CPU real.
import { beforeAll, describe, expect, it } from "vitest";
import { buslog, EV, FRAME, LINE, probe, refContention } from "./harness";

let p: Awaited<ReturnType<typeof probe>>;
beforeAll(async () => {
  p = await probe();
});

describe("ULA-01 tabla de contención", () => {
  it("los 69 888 T coinciden con el modelo de docs §4", () => {
    const bad: string[] = [];
    for (let t = 0; t < FRAME + 256; t++) {
      const got = p.x.zx_t_contention(t), exp = refContention(t);
      if (got !== exp && bad.length < 10) bad.push(`t=${t}: ${got} != ${exp}`);
    }
    expect(bad).toEqual([]);
  });

  it("puntos fijos de TEST-PLAN ULA-01", () => {
    const fixed: [number, number][] = [
      [14334, 0], [14335, 6], [14336, 5], [14337, 4], [14338, 3], [14339, 2], [14340, 1],
      [14341, 0], [14342, 0], [14343, 6], [14462, 0], [14461, 0], [14455, 6], [14463, 0],
      [14335 + LINE, 6], [57119, 6], [57119 + 127, 0], [57119 + 128, 0], [57119 + LINE, 0], [69887, 0],
    ];
    for (const [t, v] of fixed) expect(p.x.zx_t_contention(t), `t=${t}`).toBe(v);
  });
});

describe("contención de M1 (NOP)", () => {
  // NOP en 0x4000 (contendida) y en 0x8000 (libre). RAM a 0 tras reset = NOPs.
  function nopAt(pc: number, t: number) {
    p.x.zx_reset();
    p.x.zx_t_set_int_enabled(0);
    p.x.zx_set_pc(pc);
    p.x.zx_t_set_tstate(t);
    p.x.zx_t_buslog_enable(1);
    p.x.zx_step();
    const ev = buslog(p.core);
    p.x.zx_t_buslog_enable(0);
    return { t: p.x.zx_tstate(), ev };
  }

  it("en 0x4000 suma el retardo de la tabla en cada fase de la línea 10", () => {
    const l10 = 14335 + 10 * LINE;
    for (let k = -2; k <= 130; k++) {
      const t0 = l10 + k;
      const r = nopAt(0x4000, t0);
      expect(r.t, `k=${k}`).toBe(t0 + refContention(t0) + 4);
      // Convención FUSE: MC en el T de inicio (antes de la contención), MR al final.
      expect(r.ev[0]).toMatchObject({ t: t0, kind: EV.MC, addr: 0x4000 });
      expect(r.ev[1]).toMatchObject({ t: r.t, kind: EV.MR, addr: 0x4000 });
    }
  });

  it("ULA-04: sin retardo en 0x8000, en el borde superior/inferior y en el lateral", () => {
    for (const t0 of [14335, 14336, 20000]) expect(nopAt(0x8000, t0).t).toBe(t0 + 4);
    for (const t0 of [0, 100, 14334, 14335 - LINE, 14335 + 192 * LINE, 14335 + 192 * LINE + 3, 69000])
      expect(nopAt(0x4000, t0).t, `t=${t0}`).toBe(t0 + 4);
    for (let o = 128; o < LINE; o++) {
      const t0 = 14335 + 50 * LINE + o;
      expect(nopAt(0x7fff, t0).t, `o=${o}`).toBe(t0 + 4);
    }
  });

  it("NOPs consecutivos en zona contendida desde 14335: 6+4, luego fase 6 → 0", () => {
    p.x.zx_reset();
    p.x.zx_t_set_int_enabled(0);
    p.x.zx_set_pc(0x4000);
    p.x.zx_t_set_tstate(14335);
    const ts: number[] = [];
    for (let i = 0; i < 4; i++) {
      p.x.zx_step();
      ts.push(p.x.zx_tstate());
    }
    // 14335 +6 → 14341, +4 = 14345 (fase 2 → +4), 14353 (fase 2: 14345-14335=10 → 10%8=2 → 4)…
    const exp: number[] = [];
    let t = 14335;
    for (let i = 0; i < 4; i++) {
      t += refContention(t) + 4;
      exp.push(t);
    }
    expect(ts).toEqual(exp);
    expect(ts[0]).toBe(14345);
  });
});
