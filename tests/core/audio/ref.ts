// Modelo de referencia del beeper (REF, docs/TEST-PLAN.md §0), escrito aparte del
// núcleo y lento a propósito: integra la señal muestra a muestra con la definición del
// filtro caja (media exacta de la señal en [k·P, (k+1)·P), P = 3,5e6/rate T-states) sobre
// el TIEMPO GLOBAL (sin frames), y aplica los filtros en double con Math.exp.
//
// Niveles: Fuse 1.6.0 (peripherals/ula.c + sound.c, ver core/src/audio.c), índice
// EAR<<1 | MIC tal como se escriben los bits 4 y 3 de 0xFE.
export const CPU_HZ = 3_500_000;
export const FRAME = 69888;
export const FUSE_LEVEL = [0, 0, 52, 50].map((v) => v / 52);
export const HP_HZ = 25;
export const LP_HZ = 7000;

/** Transición en tiempo global (T-states desde el reset). */
export interface Edge { t: number; code: number }

/** Muestras crudas (caja, sin filtros) para las primeras `n` muestras. */
export function boxSamples(edges: Edge[], rate: number, n: number): Float64Array {
  const out = new Float64Array(n);
  // Unidades enteras T×rate: la muestra k cubre [k·CPU_HZ, (k+1)·CPU_HZ).
  let e = 0;
  let level = 0;   // código 0 al reset
  for (let k = 0; k < n; k++) {
    const a = k * CPU_HZ, b = a + CPU_HZ;
    let x = a, acc = 0;
    while (e < edges.length && edges[e]!.t * rate < b) {
      const te = Math.max(edges[e]!.t * rate, a);
      acc += FUSE_LEVEL[level]! * (te - x);
      x = te;
      level = edges[e]!.code;
      e++;
    }
    acc += FUSE_LEVEL[level]! * (b - x);
    out[k] = acc / CPU_HZ;
  }
  return out;
}

export function filter(x: Float64Array, rate: number): Float64Array {
  const a = Math.exp((-2 * Math.PI * HP_HZ) / rate);
  const b = 1 - Math.exp((-2 * Math.PI * LP_HZ) / rate);
  const out = new Float64Array(x.length);
  let x1 = 0, y1 = 0, z1 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = a * (y1 + x[i]! - x1);
    const z = z1 + b * (y - z1);
    x1 = x[i]!; y1 = y; z1 = z;
    out[i] = z;
  }
  return out;
}

/** Onda cuadrada de EAR (bit 4) con periodo P T-states (puede ser fraccional). */
export function squareEdges(P: number, until: number, mic = 0): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; ; i++) {
    const t = Math.round((i * P) / 2);
    if (t >= until) break;
    edges.push({ t, code: (i % 2 === 0 ? 2 : 0) | mic });
  }
  return edges;
}

/** Frecuencia por cruces ascendentes por cero con interpolación lineal. */
export function zeroCrossFreq(s: ArrayLike<number>, rate: number, from = 0): number {
  const xs: number[] = [];
  for (let i = Math.max(1, from); i < s.length; i++) {
    const p = s[i - 1]!, c = s[i]!;
    if (p < 0 && c >= 0) xs.push(i - 1 + -p / (c - p));
  }
  if (xs.length < 3) return 0;
  return ((xs.length - 1) * rate) / (xs[xs.length - 1]! - xs[0]!);
}

/** Pico de la DFT (barrido fino alrededor de una estimación) — segunda medida. */
export function dftPeak(s: ArrayLike<number>, rate: number, from: number, f0: number): number {
  const mag = (f: number) => {
    let re = 0, im = 0;
    for (let i = from; i < s.length; i++) {
      const w = (2 * Math.PI * f * i) / rate;
      re += s[i]! * Math.cos(w);
      im += s[i]! * Math.sin(w);
    }
    return re * re + im * im;
  };
  let best = f0, bestM = -1;
  for (let f = f0 * 0.98; f <= f0 * 1.02; f += f0 * 0.0005) {
    const m = mag(f);
    if (m > bestM) { bestM = m; best = f; }
  }
  return best;
}
