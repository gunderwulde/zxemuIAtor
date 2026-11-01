// ULA-40 (resampler) sobre audio-harness.wasm: audio.c aislado, con OUTs sintéticos en
// T-states exactos (no depende de la CPU). Lo compila tools/audio-build-harness.mjs.
// Oráculos: DOC (3,5e6/P, nº de muestras exacto, niveles de Fuse) y REF (ref.ts).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ROOT, WASM_DIR } from "../../util/wasm";
import { boxSamples, CPU_HZ, dftPeak, type Edge, filter, FRAME, FUSE_LEVEL, squareEdges, zeroCrossFreq } from "./ref";

interface Harness {
  memory: WebAssembly.Memory;
  h_reset(): void;
  h_out(t: number, fe: number): void;
  h_end(len: number): void;
  zx_audio_render(rate: number): number;
  zx_audio_buffer(): number;
  zx_t_beeper_log(): number;
  zx_t_beeper_log_len(): number;
}

let h: Harness;

beforeAll(async () => {
  execFileSync(process.execPath, [join(ROOT, "tools", "audio-build-harness.mjs")], { stdio: "pipe" });
  const { instance } = await WebAssembly.instantiate(readFileSync(join(WASM_DIR, "audio-harness.wasm")), {});
  h = instance.exports as unknown as Harness;
});

/** Ejecuta `frames` frames de longitud `len` con las transiciones globales dadas
 * (como zx48.c: los OUT del frame f llegan con t relativo al frame, y los que caen
 * en [len, len+excess) llegan ANTES de cerrar el frame, con t >= len). */
function run(edges: Edge[], frames: number, rate: number, opts: { len?: number; excess?: number } = {}) {
  const len = opts.len ?? FRAME;
  const excess = opts.excess ?? 0;
  h.h_reset();
  const out: number[] = [];
  const perFrame: number[] = [];
  let e = 0;
  for (let f = 0; f < frames; f++) {
    const base = f * len;
    while (e < edges.length && edges[e]!.t < base + len + excess) {
      h.h_out(edges[e]!.t - base, edges[e]!.code << 3);
      e++;
    }
    h.h_end(len);
    const n = h.zx_audio_render(rate);
    perFrame.push(n);
    const buf = new Float32Array(h.memory.buffer, h.zx_audio_buffer(), n);
    for (let i = 0; i < n; i++) out.push(buf[i]!);
  }
  return { out: Float64Array.from(out), perFrame };
}

describe("ULA-40 resampler (harness)", () => {
  it("nº exacto de muestras a lo largo de muchos frames y varias frecuencias", () => {
    for (const rate of [8000, 22050, 44100, 48000, 96000, 192000]) {
      const frames = 3000;
      const { out } = run([], frames, rate);
      expect(out.length, `rate ${rate}`).toBe(Math.floor((frames * FRAME * rate) / CPU_HZ));
    }
  });

  it("render sin frame nuevo devuelve 0 (no duplica audio)", () => {
    h.h_reset();
    h.h_end(FRAME);
    expect(h.zx_audio_render(48000)).toBe(958);
    expect(h.zx_audio_render(48000)).toBe(0);
  });

  for (const [P, rate] of [[8000, 48000], [13378, 44100], [1000, 48000], [7919, 44100], [400, 96000]] as const) {
    it(`cuadrada de P=${P} T @${rate} Hz → fundamental 3,5e6/P ±0,5 % (cruces y DFT)`, () => {
      const frames = 50;
      const { out } = run(squareEdges(P, frames * FRAME), frames, rate);
      const want = CPU_HZ / P;
      const skip = Math.floor(rate * 0.1);   // deja asentar el bloqueo de DC
      const fz = zeroCrossFreq(out, rate, skip);
      const fd = dftPeak(out, rate, skip, want);
      expect(Math.abs(fz / want - 1), `cruces: ${fz} Hz frente a ${want}`).toBeLessThan(0.005);
      expect(Math.abs(fd / want - 1), `DFT: ${fd} Hz frente a ${want}`).toBeLessThan(0.005);
    });
  }

  it("sin DC tras el filtro: media nula sobre periodos enteros; nivel fijo decae a 0", () => {
    const rate = 48000, P = 8000, frames = 100;
    const { out } = run(squareEdges(P, frames * FRAME), frames, rate);
    // Ventana final de 400 periodos exactos (400·P·rate/CPU_HZ muestras).
    const n = Math.round((400 * P * rate) / CPU_HZ);
    let sum = 0, peak = 0;
    for (let i = out.length - n; i < out.length; i++) { sum += out[i]!; peak = Math.max(peak, Math.abs(out[i]!)); }
    expect(Math.abs(sum / n)).toBeLessThan(1e-3);   // la señal cruda tendría media 0,5
    expect(peak).toBeGreaterThan(0.4);

    const held = run([{ t: 100, code: 2 }], 100, rate).out;   // EAR=1 fijo 2 s
    expect(held[50]!).toBeGreaterThan(0.5);
    expect(Math.abs(held[held.length - 1]!)).toBeLessThan(1e-4);
  });

  it("continuidad entre frames: idéntico al modelo REF de tiempo global (con exceso de T)", () => {
    const rate = 44100;
    // Periodo que no divide al frame y transiciones que caen junto a las fronteras.
    const frames = 40;
    const edges = squareEdges(3331.7, frames * FRAME);
    for (let f = 1; f < frames; f++) edges.push({ t: f * FRAME - 1, code: 3 }, { t: f * FRAME + 2, code: 0 });
    edges.sort((a, b) => a.t - b.t);
    // Quita transiciones redundantes y empates para que REF y núcleo vean la misma señal.
    const clean: Edge[] = [];
    let last = 0;
    for (const e of edges) {
      if (clean.length && clean[clean.length - 1]!.t === e.t) { clean[clean.length - 1] = e; last = e.code; continue; }
      if (e.code !== last) { clean.push(e); last = e.code; }
    }
    for (const excess of [0, 23]) {
      const { out } = run(clean, frames, rate, { excess });
      const ref = filter(boxSamples(clean, rate, out.length), rate);
      let worst = 0;
      for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i]! - ref[i]!));
      expect(worst, `exceso ${excess}`).toBeLessThan(2e-4);
    }
  });

  it("frontera de frame sin salto: el escalón máximo en fronteras no supera al interior", () => {
    const rate = 48000, frames = 60;
    const { out, perFrame } = run(squareEdges(6000, frames * FRAME), frames, rate);
    const bounds = new Set<number>();
    let acc = 0;
    for (const n of perFrame) { acc += n; bounds.add(acc); }
    let inner = 0, edge = 0;
    for (let i = rate / 10; i < out.length; i++) {
      const d = Math.abs(out[i]! - out[i - 1]!);
      if (bounds.has(i)) edge = Math.max(edge, d); else inner = Math.max(inner, d);
    }
    expect(edge).toBeLessThanOrEqual(inner);
  });

  it("niveles EAR/MIC (Fuse): EAR=1,MIC=0 > EAR=1,MIC=1 > EAR=0 (MIC solo = silencio)", () => {
    // Respuesta al escalón desde código 0 en una frontera de muestra: proporcional al nivel.
    const rate = 50000;   // 70 T por muestra exactos
    const step = (code: number) => run([{ t: 7000, code }], 1, rate).out[100]!;
    const r = [0, 1, 2, 3].map(step);
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(0);
    expect(r[3]! / r[2]!).toBeCloseTo(FUSE_LEVEL[3]! / FUSE_LEVEL[2]!, 6);
    expect(r[2]!).toBeGreaterThan(r[3]!);
    expect(r[3]!).toBeGreaterThan(r[1]!);
  });

  it("log de transiciones: sólo cambios de EAR/MIC, t exacto, exceso pasa al frame siguiente", () => {
    h.h_reset();
    h.h_out(100, 0x10);          // EAR
    h.h_out(200, 0x17);          // mismo EAR/MIC, cambia el borde: no es transición
    h.h_out(300, 0x18);          // EAR+MIC
    h.h_out(FRAME + 5, 0x00);    // la última instrucción cruza el límite
    const log = () => Array.from(new Uint32Array(h.memory.buffer, h.zx_t_beeper_log(), 2 * h.zx_t_beeper_log_len()));
    expect(log()).toEqual([100, 2, 300, 3, FRAME + 5, 0]);
    h.h_end(FRAME);
    expect(log()).toEqual([5, 0]);
  });

  it("desbordamiento del log: no corrompe memoria y el nivel final es el último escrito", () => {
    h.h_reset();
    for (let i = 0; i < 20000; i++) h.h_out(i * 3, i % 2 ? 0 : 0x10);   // 20000 cambios en 60000 T
    expect(h.zx_t_beeper_log_len()).toBe(8192);
    h.h_out(65000, 0x18);
    h.h_end(FRAME);
    expect(h.zx_audio_render(48000)).toBe(958);
    h.h_end(FRAME);
    const n = h.zx_audio_render(48000);
    const buf = new Float32Array(h.memory.buffer, h.zx_audio_buffer(), n);
    // Frame entero a EAR+MIC: el filtro responde con un nivel positivo que decae, sin NaN.
    expect(Number.isFinite(buf[n - 1]!)).toBe(true);
    expect(buf[0]!).toBeGreaterThan(0);
  });
});
