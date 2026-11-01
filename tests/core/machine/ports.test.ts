// ULA-03 (contención de E/S), ULA-20/21 (puerto 0xFE), ULA-23 (bus flotante) sobre
// m1-harness.wasm: los ciclos de E/S de zx48.c llamados directamente (no depende de C1).
// Oráculos:
//  - DOC docs §5 (4 patrones N/C) para el T total.
//  - EXT Fuse z80/coretest.c para los eventos (PC antes de cada contención, PR/PW tras
//    el primer T) y periph.c readport/writeport para el instante de lectura/escritura.
//  - DOC docs §6 (teclado, Issue 2/3) y §8 + Fuse spectrum_unattached_port (bus flotante).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attrAddr, buslog, EV, type Ev, harness, LINE, pixAddr, refContention } from "./harness";

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
});
beforeEach(() => {
  h.x.zx_reset();
  h.x.zx_t_set_int_enabled(0);
});

const contendedHigh = (port: number) => (port & 0xc000) === 0x4000;

/** docs §5: lista de pasos [contendido?, T]. */
function pattern(port: number): [boolean, number][] {
  const hi = contendedHigh(port), ula = (port & 1) === 0;
  if (!hi && ula) return [[false, 1], [true, 3]];
  if (!hi && !ula) return [[false, 1], [false, 3]]; // N:4; PR/PW tras el primer T
  if (hi && ula) return [[true, 1], [true, 3]];
  return [[true, 1], [true, 1], [true, 1], [true, 1]];
}

/** Modelo del ciclo: T final, T de PR/PW (tras el primer paso), T de muestreo (1 T antes
 * del final) y eventos PC esperados (Fuse coretest: un PC por cada C, antes del retardo). */
export function model(port: number, t0: number) {
  let t = t0, ioT = 0;
  const pcs: number[] = [];
  pattern(port).forEach(([c, n], i) => {
    if (c) {
      pcs.push(t);
      t += refContention(t);
    }
    t += n;
    if (i === 0) ioT = t;
  });
  return { end: t, ioT, sample: t - 1, pcs };
}

function events(): Ev[] {
  return buslog(h.core);
}

const PORTS = [0x00fe, 0x40fe, 0x00ff, 0x40ff, 0x7ffe, 0x80ff, 0x7fff, 0xc0fe];

describe("ULA-03 contención de E/S", () => {
  for (const port of PORTS) {
    it(`IN/OUT 0x${port.toString(16).padStart(4, "0")} en las fases k=-2..9 de L(10) y en el borde`, () => {
      const l10 = 14335 + 10 * LINE;
      const starts = [...Array.from({ length: 12 }, (_, i) => l10 - 2 + i), l10 + 124, l10 + 126, l10 + 130, 1000, 60000];
      for (const t0 of starts) {
        const m = model(port, t0);
        for (const dir of ["in", "out"] as const) {
          h.x.zx_t_set_tstate(t0);
          h.x.zx_t_buslog_enable(1);
          if (dir === "in") h.x.h_in(port);
          else h.x.h_out(port, 0x07);
          const ev = events();
          h.x.zx_t_buslog_enable(0);
          const tag = `${dir} t0=${t0}`;
          expect(h.x.zx_tstate(), tag).toBe(m.end);
          const io = ev.filter((e) => e.kind === EV.PR || e.kind === EV.PW);
          expect(io, tag).toHaveLength(1);
          expect(io[0], tag).toMatchObject({ t: m.ioT, addr: port, kind: dir === "in" ? EV.PR : EV.PW });
          expect(ev.filter((e) => e.kind === EV.PC).map((e) => e.t), tag).toEqual(m.pcs);
          expect(ev.filter((e) => e.kind === EV.MC || e.kind === EV.MR || e.kind === EV.MW), tag).toEqual([]);
        }
      }
    });
  }

  it("orden de eventos FUSE para 0x40FE: PC, PR, PC", () => {
    h.x.zx_t_set_tstate(1000);
    h.x.zx_t_buslog_enable(1);
    h.x.h_in(0x40fe);
    expect(events().map((e) => [e.t, e.kind])).toEqual([[1000, EV.PC], [1001, EV.PR], [1001, EV.PC]]);
  });

  it("el valor del evento PR es el leído", () => {
    h.x.zx_key(0, 1, 1); // Z
    h.x.zx_t_set_tstate(1000);
    h.x.zx_t_buslog_enable(1);
    const v = h.x.h_in(0xfefe);
    expect(events().find((e) => e.kind === EV.PR)!.value).toBe(v);
    expect(v & 0x1f).toBe(0x1d);
  });
});

/** Semifilas de docs §6, en el orden de zx_key(row, …). */
const ROW_PORTS = [0xfefe, 0xfdfe, 0xfbfe, 0xf7fe, 0xeffe, 0xdffe, 0xbffe, 0x7ffe];

describe("ULA-20 teclado", () => {
  it("cada una de las 40 teclas sólo baja su bit en su semifila", () => {
    for (let row = 0; row < 8; row++)
      for (let bit = 0; bit < 5; bit++) {
        h.x.zx_key(row, bit, 1);
        for (let r = 0; r < 8; r++) {
          const v = h.x.h_in(ROW_PORTS[r]!);
          expect(v & 0x1f, `tecla ${row}.${bit} leída en fila ${r}`).toBe(r === row ? 0x1f & ~(1 << bit) : 0x1f);
          expect(v & 0xa0).toBe(0xa0);
        }
        h.x.zx_key(row, bit, 0);
      }
  });

  it("varias semifilas a la vez → AND; cualquier puerto par responde", () => {
    h.x.zx_key(0, 0, 1); // CAPS
    h.x.zx_key(7, 4, 1); // B
    h.x.zx_key(3, 2, 1); // 3
    expect(h.x.h_in(0x00fe) & 0x1f).toBe(0x1f & ~1 & ~16 & ~4);
    expect(h.x.h_in(0x7efe) & 0x1f).toBe(0x1f & ~1 & ~16);
    expect(h.x.h_in(0xff12) & 0x1f).toBe(0x1f); // byte alto 0xFF: ninguna fila
    expect(h.x.h_in(0x7f00) & 0x1f).toBe(0x1f & ~16);
    expect(h.x.h_in(0xfe00) & 0x1f).toBe(0x1e);
  });

  it("ghosting: tres esquinas de un rectángulo producen la cuarta", () => {
    // Filas 1 (A S D F G) y 2 (Q W E R T), columnas 0 y 3: A, F, Q pulsadas → R aparece.
    h.x.zx_key(1, 0, 1);
    h.x.zx_key(1, 3, 1);
    h.x.zx_key(2, 0, 1);
    expect(h.x.h_in(0xfbfe) & 0x1f).toBe(0x1f & ~1 & ~8); // Q y R (fantasma)
    expect(h.x.h_in(0xfdfe) & 0x1f).toBe(0x1f & ~1 & ~8); // A y F
    // Sin la tercera esquina no hay fantasma.
    h.x.zx_key(2, 0, 0);
    expect(h.x.h_in(0xfbfe) & 0x1f).toBe(0x1f);
    // Cadena: fila 1 tiene A (col 0); col 0 → fila 2 (Q); fila 2 tiene W (col 1);
    // col 1 → fila 5 (O). Al leer la fila 1 o la 5 bajan las columnas 0 y 1.
    h.x.zx_key(1, 3, 0);
    h.x.zx_key(2, 0, 1);
    h.x.zx_key(2, 1, 1);
    h.x.zx_key(5, 1, 1);
    expect(h.x.h_in(0xfdfe) & 0x1f).toBe(0x1f & ~1 & ~2);
    expect(h.x.h_in(0xdffe) & 0x1f).toBe(0x1f & ~1 & ~2);
    // Una fila sin teclas no se contamina.
    expect(h.x.h_in(0xf7fe) & 0x1f).toBe(0x1f);
  });
});

describe("ULA-21 bit 6 (EAR) Issue 2/3", () => {
  // docs §6 / Fuse ula_write: Issue 3 → bit 6 = bit 4 escrito; Issue 2 → 0 sólo si bits 3 y 4 son 0.
  for (const issue of [2, 3])
    for (const bits of [0x00, 0x08, 0x10, 0x18]) {
      const exp = issue === 3 ? (bits & 0x10 ? 1 : 0) : bits ? 1 : 0;
      it(`Issue ${issue}, bit4=${bits >> 4 & 1} bit3=${bits >> 3 & 1} → bit6=${exp}`, () => {
        h.x.zx_set_issue(issue);
        h.x.h_out(0x00fe, bits | 0x07);
        expect((h.x.h_in(0xfefe) >> 6) & 1).toBe(exp);
        h.x.zx_set_issue(3);
      });
    }
});

describe("ULA-23 bus flotante", () => {
  function fill() {
    // Bitmap = addr & 0xFF y atributo = 0x80 | algo, nunca 0xFF para distinguirlos del bus libre.
    for (let a = 0x4000; a < 0x5800; a++) h.x.zx_poke(a, (a & 0xff) === 0xff ? 0xfe : a & 0xff);
    for (let a = 0x5800; a < 0x5b00; a++) h.x.zx_poke(a, 0x80 | ((a * 7) & 0x7f));
  }

  /** Fuse spectrum_unattached_port evaluado en el T de muestreo s. */
  function ref(s: number): number {
    if (s < 14336) return 0xff;
    const line = Math.floor((s - 14336) / LINE), o = (s - 14336) % LINE;
    if (line >= 192 || o >= 128) return 0xff;
    const col = (o >> 3) * 2;
    const mem = h.core.ram();
    switch (o & 7) {
      case 2: return mem[pixAddr(col, line)]!;
      case 3: return mem[attrAddr(col, line)]!;
      case 4: return mem[pixAddr(col + 1, line)]!;
      case 5: return mem[attrAddr(col + 1, line)]!;
      default: return 0xff;
    }
  }

  it("primer byte en T 14338 (Fuse): IN 0x00FF que empieza en 14335 devuelve el bitmap 0x4000", () => {
    fill();
    h.x.zx_t_set_tstate(14335);
    expect(h.x.h_in(0x00ff)).toBe(h.core.ram()[0x4000]);
    h.x.zx_t_set_tstate(14336);
    expect(h.x.h_in(0x00ff)).toBe(h.core.ram()[0x5800]);
    h.x.zx_t_set_tstate(14334);
    expect(h.x.h_in(0x00ff)).toBe(0xff);
  });

  for (const port of [0x00ff, 0x40ff, 0x80ff])
    it(`barrido de líneas 0,1,7,8,100,191 y borde, puerto 0x${port.toString(16)}`, () => {
      fill();
      for (const line of [0, 1, 7, 8, 100, 191, -1, 192])
        for (let o = 0; o < LINE; o++) {
          const t0 = 14336 + line * LINE + o - 3;
          h.x.zx_t_set_tstate(t0);
          const v = h.x.h_in(port);
          const s = model(port, t0).sample;
          expect(v, `línea ${line} o=${o} s=${s}`).toBe(ref(s));
        }
    });

  it("los puertos pares nunca devuelven bus flotante", () => {
    fill();
    for (let o = 0; o < 16; o++) {
      h.x.zx_t_set_tstate(14335 + o);
      expect(h.x.h_in(0xfffe)).toBe(0xbf); // Issue 3, EAR 0, sin teclas
    }
  });
});
