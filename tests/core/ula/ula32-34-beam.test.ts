// ULA-32 (temporización del borde), ULA-33 (multicolor / escritura durante el barrido)
// y ULA-34 (render perezoso ≡ render ingenuo) · DOC §7 + REF tests/ref/video.ts.
//
// Dos grupos:
//  [M1]     escrituras con zx_poke en un T exacto (zx_t_set_tstate + zx_poke). zx_poke
//           escribe "en" zx_tstate(), igual que una escritura de la CPU cuyo ciclo
//           termina en ese T (convención de tests/ref/video.ts). No necesitan CPU. Sólo
//           se compara el área de pantalla (el borde inicial tras el reset no está
//           especificado).
//  [C1+M1]  OUT al borde y LD (HL),A ejecutados por la CPU; el T de cada evento lo
//           calcula el REF de contención. Se compara el framebuffer entero: el primer
//           OUT se hace en T 100, antes de la primera línea visible (T 3560).
//
// El T sólo se mueve hacia delante entre eventos (el render perezoso no puede volver
// atrás); entre eventos la CPU no ejecuta nada.
import { describe, expect, it } from "vitest";
import { lineStart, PATTERNS, runPattern } from "../../ref/contention";
import {
  attrAddr, bitmapAddr, BORDER_LEFT, BORDER_TOP, FB_HEIGHT, FB_WIDTH, firstFbDiff, flashInvertedForFrame, groupT,
  renderFrame, type VideoEvent,
} from "../../ref/video";
import { Probe } from "../../util/probe";

const SOAK = process.env.ZX_SOAK === "1";
const FULL = process.env.ZX_FULL === "1";

async function beamProbe(): Promise<Probe> {
  const p = await Probe.create();
  p.x.zx_t_set_int_enabled(0);
  p.poke(0x8002, [0x18, 0xfe]); // JR $ (bucle de espera hasta el fin del frame)
  p.setRegs({ pc: 0x8002, iff1: 0, iff2: 0, sp: 0xf000 });
  return p;
}

function screenDiff(fb: Uint8Array, ref: Uint8Array): string | null {
  for (let y = BORDER_TOP; y < BORDER_TOP + 192; y++) {
    for (let x = BORDER_LEFT; x < BORDER_LEFT + 256; x++) {
      const o = (y * FB_WIDTH + x) * 4;
      if (fb[o] !== ref[o] || fb[o + 1] !== ref[o + 1] || fb[o + 2] !== ref[o + 2]) {
        return `pantalla (${x - BORDER_LEFT},${y - BORDER_TOP}) T ${groupT(x >> 3, y)}: ${[...fb.subarray(o, o + 3)]} esperado ${[...ref.subarray(o, o + 3)]}`;
      }
    }
  }
  return null;
}

/** zx_poke en el T t (≥ T actual). Devuelve el evento REF. */
function pokeAt(p: Probe, t: number, addr: number, value: number): VideoEvent {
  if (t < p.t) throw new Error(`pokeAt: T ${t} < T actual ${p.t}`);
  p.t = t;
  p.x.zx_poke(addr, value);
  return { t, kind: "mem", addr, value };
}

/** OUT (0xFE),A ejecutado por la CPU empezando en t0. Devuelve el evento REF. */
function outAt(p: Probe, t0: number, colour: number): VideoEvent {
  if (t0 < p.t) throw new Error(`outAt: T ${t0} < T actual ${p.t}`);
  p.poke(0x8000, [0xd3, 0xfe]); // OUT (0xFE),A
  p.setRegs({ pc: 0x8000, af: (colour << 8) | 0xff });
  p.t = t0;
  p.step();
  const port = (colour << 8) | 0xfe;
  return { t: runPattern(t0, PATTERNS.outNA(0x8000, port)).timings[2]!.dataT!, kind: "border", value: colour & 7 };
}

/** LD (HL),A ejecutado por la CPU empezando en t0 (código en 0x8000, no contendido). */
function ldAt(p: Probe, t0: number, addr: number, value: number): VideoEvent {
  if (t0 < p.t) throw new Error(`ldAt: T ${t0} < T actual ${p.t}`);
  p.poke(0x8000, [0x77]); // LD (HL),A
  p.setRegs({ pc: 0x8000, hl: addr, af: (value << 8) | 0xff });
  p.t = t0;
  p.step();
  return { t: runPattern(t0, PATTERNS.ldHLr(0x8000, addr)).timings[1]!.accessT!, kind: "mem", addr, value };
}

function finish(p: Probe): Uint8Array {
  p.setRegs({ pc: 0x8002 });
  p.runFrame();
  return p.fb();
}

// ---------------------------------------------------------------------------

describe("[C1+M1] ULA-32 temporización del borde", () => {
  /** Frame con borde azul desde T 100 y un cambio a rojo con fin de ciclo de E/S en `end`. */
  async function oneChange(end: number): Promise<string | null> {
    const p = await beamProbe();
    const scr = new Uint8Array(6912).fill(0x38, 6144); // pantalla blanca (papel 7)
    p.poke(0x4000, scr);
    const ev = [outAt(p, 100, 1), outAt(p, end - 11, 2)]; // D3 n: 7 T + E/S de 4 T
    const fb = finish(p);
    return firstFbDiff(fb, renderFrame({ screen: scr, border: 0, flashInverted: false, events: ev }));
  }

  it("fin del OUT en cada T de 14 330 a 14 350 (DOC §7: 14 339–14 342 → posición del byte 16384)", async () => {
    const bad: string[] = [];
    for (let end = 14330; end <= 14350; end++) {
      const d = await oneChange(end);
      if (d) bad.push(`fin ${end}: ${d}`);
    }
    expect(bad).toEqual([]);
  });

  it("línea 100: todos los offsets 0…223", async () => {
    const bad: string[] = [];
    const lineT0 = groupT(0, BORDER_TOP + 100); // primer grupo visible de la línea 100
    for (let off = 0; off < 224; off++) {
      const d = await oneChange(lineT0 + off);
      if (d && bad.length < 8) bad.push(`offset ${off}: ${d}`);
    }
    expect(bad).toEqual([]);
  });

  it("granularidad de 8 px: cuatro T consecutivos de escritura en el borde dan la misma imagen", async () => {
    // En el borde (aquí el grupo gx = 10 de la línea fy = 20 del borde superior), con dataT
    // del OUT = fin − 3: dataT Tg..Tg+3 cambia el color a partir del grupo g (REF: el grupo
    // ve los eventos con t ≤ Tg+3); Tg+4 ya sólo a partir del g+1 (DOC §7). En el área de
    // pantalla no se vería: el borde no se pinta allí.
    const tg = groupT(10, 20);
    const fbs: Uint8Array[] = [];
    for (let dataT = tg; dataT <= tg + 4; dataT++) {
      const p = await beamProbe();
      outAt(p, 100, 1);
      outAt(p, dataT + 3 - 11, 2);
      fbs.push(finish(p));
    }
    for (let i = 1; i < 4; i++) expect(firstFbDiff(fbs[i]!, fbs[0]!), `dataT Tg+${i}`).toBeNull();
    expect(firstFbDiff(fbs[4]!, fbs[0]!)).not.toBeNull();
  });

  it("rayas: varios cambios por línea en los bordes superior, inferior, izquierdo y derecho", async () => {
    const p = await beamProbe();
    const ev: VideoEvent[] = [outAt(p, 100, 0)];
    let t = 3000;
    let c = 1;
    // Borde superior (líneas 0–47 del framebuffer): cambio cada 37 T.
    while (t < groupT(0, 40)) { ev.push(outAt(p, t, c++ & 7)); t += 37; }
    // Líneas de pantalla 20–22: cambios en los bordes izquierdo y derecho.
    for (const y of [20, 21, 22]) {
      const base = groupT(0, BORDER_TOP + y);
      for (const off of [0, 13, 30, 160, 175, 190]) {
        const t0 = base + off - 8;
        if (t0 >= p.t) ev.push(outAt(p, t0, c++ & 7));
      }
    }
    // Borde inferior.
    t = groupT(0, BORDER_TOP + 195);
    while (t < groupT(0, FB_HEIGHT - 2)) { ev.push(outAt(p, t, c++ & 7)); t += 53; }
    const fb = finish(p);
    expect(firstFbDiff(fb, renderFrame({ screen: new Uint8Array(6912), border: 0, flashInverted: false, events: ev }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("[M1] ULA-33 multicolor con zx_poke en T exactos", () => {
  // Celda (x=10, fila de caracteres 5): líneas 40..47.
  const X = 10, Y0 = 40;

  it("punto de corte: escritura de atributo en Tc+3 entra en la línea; en Tc+4 entra en la siguiente", async () => {
    const bad: string[] = [];
    for (const k of [-6, -2, -1, 0, 1, 2, 3, 4, 5, 8]) {
      const p = await beamProbe();
      const scr = new Uint8Array(6912).fill(0xf0, 0, 6144).fill(0x07, 6144);
      p.poke(0x4000, scr);
      const tc = groupT(BORDER_LEFT / 8 + X, BORDER_TOP + Y0 + 3); // la ULA dibuja (x, línea 43) en tc
      const ev = [pokeAt(p, tc + k, attrAddr(X, Y0), 0x16)]; // tinta 6, papel 2
      const ref = renderFrame({ screen: scr, border: 0, flashInverted: false, events: ev });
      const d = screenDiff(finish(p), ref);
      if (d) bad.push(`Tc${k >= 0 ? "+" : ""}${k}: ${d}`);
    }
    expect(bad).toEqual([]);
  });

  it("igual con un byte de bitmap", async () => {
    const bad: string[] = [];
    for (const k of [-1, 0, 3, 4, 7]) {
      const p = await beamProbe();
      const scr = new Uint8Array(6912).fill(0x07, 6144);
      p.poke(0x4000, scr);
      const tc = groupT(BORDER_LEFT / 8 + X, BORDER_TOP + Y0);
      const ev = [pokeAt(p, tc + k, bitmapAddr(X, Y0), 0xaa)];
      const d = screenDiff(finish(p), renderFrame({ screen: scr, border: 0, flashInverted: false, events: ev }));
      if (d) bad.push(`Tc+${k}: ${d}`);
    }
    expect(bad).toEqual([]);
  });

  it("8×1: un atributo distinto en cada una de las 8 líneas de la celda", async () => {
    const p = await beamProbe();
    const scr = new Uint8Array(6912).fill(0xf0, 0, 6144).fill(0x07, 6144);
    p.poke(0x4000, scr);
    const ev: VideoEvent[] = [];
    for (let k = 0; k < 8; k++) {
      // Justo después de que la ULA lea la línea anterior (Tc(línea−1) + 4).
      const t = k === 0 ? 1000 : groupT(BORDER_LEFT / 8 + X, BORDER_TOP + Y0 + k - 1) + 4;
      ev.push(pokeAt(p, t, attrAddr(X, Y0), 0x40 | (k << 3) | (7 - k)));
    }
    const fb = finish(p);
    expect(screenDiff(fb, renderFrame({ screen: scr, border: 0, flashInverted: false, events: ev }))).toBeNull();
    // Y, por si el REF se equivocara igual que el núcleo: 8 colores de tinta distintos.
    const inks = new Set<string>();
    for (let k = 0; k < 8; k++) {
      const o = ((BORDER_TOP + Y0 + k) * FB_WIDTH + BORDER_LEFT + X * 8) * 4;
      inks.add([...fb.subarray(o, o + 3)].join());
    }
    expect(inks.size).toBe(8);
  });
});

describe("[C1+M1] ULA-33 multicolor con LD (HL),A (contención incluida)", () => {
  it("barrido del T de inicio alrededor del instante de lectura de la ULA", async () => {
    const X = 10, Y = 43;
    const bad: string[] = [];
    const tc = groupT(BORDER_LEFT / 8 + X, BORDER_TOP + Y);
    for (let k = -20; k <= 4; k++) {
      for (const [addr, val] of [[attrAddr(X, Y), 0x16], [bitmapAddr(X, Y), 0xaa]] as const) {
        const p = await beamProbe();
        const scr = new Uint8Array(6912).fill(0xf0, 0, 6144).fill(0x07, 6144);
        p.poke(0x4000, scr);
        const ev = [outAt(p, 100, 3), ldAt(p, tc + k, addr, val)];
        const d = firstFbDiff(finish(p), renderFrame({ screen: scr, border: 0, flashInverted: false, events: ev }));
        if (d && bad.length < 8) bad.push(`addr 0x${addr.toString(16)} inicio Tc${k}: ${d}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/** Generador congruencial con semilla (Numerical Recipes); determinista. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}

const FRAMES = SOAK ? 10000 : FULL ? 500 : 20;

/** T aleatorio "interesante": uniforme, en el límite de una línea o en ráfagas. */
function randomTimes(rnd: (n: number) => number, n: number): number[] {
  const ts: number[] = [];
  for (let i = 0; i < n; i++) {
    const kind = rnd(4);
    if (kind === 0) ts.push(3000 + rnd(66000));
    else if (kind === 1) ts.push(groupT(0, rnd(FB_HEIGHT)) + 224 - 2 + rnd(5)); // fin/principio de línea
    else if (kind === 2) ts.push(groupT(BORDER_LEFT / 8 + rnd(32), BORDER_TOP + rnd(192)) + rnd(8)); // junto al grupo
    else ts.push(ts.length ? ts[ts.length - 1]! + rnd(4) : 5000); // ráfaga dentro del mismo grupo de 4 T
  }
  return ts.map((t) => Math.min(t, 69700)).sort((a, b) => a - b);
}

describe(`[M1] ULA-34 render perezoso ≡ REF con zx_poke (${FRAMES} frames)`, () => {
  it("framebuffers idénticos en el área de pantalla", async () => {
    const seed = Number(process.env.ZX_SEED ?? 12345);
    const rnd = lcg(seed);
    const p = await beamProbe();
    const mirror = new Uint8Array(6912);
    for (let f = 0; f < FRAMES; f++) {
      const frame = p.x.zx_frame_count();
      const start = mirror.slice();
      const ev: VideoEvent[] = [];
      for (const t of randomTimes(rnd, 50 + rnd(300))) {
        const addr = 0x4000 + (rnd(3) === 0 ? 6144 + rnd(768) : rnd(6144));
        const v = rnd(256);
        ev.push(pokeAt(p, Math.max(t, p.t), addr, v));
        mirror[addr - 0x4000] = v;
      }
      const d = screenDiff(finish(p), renderFrame({ screen: start, border: 0, flashInverted: flashInvertedForFrame(frame), events: ev }));
      if (d) throw new Error(`semilla ${seed}, frame ${f}: ${d}`);
    }
  });
});

describe(`[C1+M1] ULA-34 render perezoso ≡ REF con OUT y zx_poke (${FRAMES} frames)`, () => {
  it("framebuffers idénticos (borde incluido)", async () => {
    const seed = Number(process.env.ZX_SEED ?? 777);
    const rnd = lcg(seed);
    const p = await beamProbe();
    const mirror = new Uint8Array(6912);
    let border = 0;
    let first = true;
    for (let f = 0; f < FRAMES; f++) {
      const frame = p.x.zx_frame_count();
      const start = mirror.slice();
      const ev: VideoEvent[] = [];
      if (first) { ev.push(outAt(p, Math.max(100, p.t), 0)); first = false; }
      const startBorder = border;
      for (const t of randomTimes(rnd, 50 + rnd(200))) {
        const tt = Math.max(t, p.t);
        if (rnd(3) === 0) {
          const e = outAt(p, tt, rnd(8));
          ev.push(e);
          border = e.value;
        } else {
          const addr = 0x4000 + (rnd(3) === 0 ? 6144 + rnd(768) : rnd(6144));
          const v = rnd(256);
          ev.push(pokeAt(p, tt, addr, v));
          mirror[addr - 0x4000] = v;
        }
      }
      const d = firstFbDiff(finish(p), renderFrame({ screen: start, border: startBorder, flashInverted: flashInvertedForFrame(frame), events: ev }));
      if (d) throw new Error(`semilla ${seed}, frame ${f}: ${d}`);
    }
  });
});
