// W1: lógica del bucle con núcleo, audio y reloj falsos (sin DOM).
import { describe, expect, it } from "vitest";
import { STOP } from "../../web/src/emu/core";
import { FRAME_MS, Loop, MAX_FRAMES_PER_TICK, TARGET_MS, type LoopAudio } from "../../web/src/emu/loop";

// 69888 T / 3,5 MHz: dato de docs/zx48-hardware.md §1, no del código.
const EXPECTED_FRAME_MS = 69888 / 3500;

class FakeCore {
  frames = 0;
  breakAt = new Set<number>();         // índice de llamada a runFrame que para en BP
  samplesPerFrame = 882;
  private calls = 0;
  runFrame(): number {
    const c = this.calls++;
    if (this.breakAt.has(c)) return STOP.BREAKPOINT;
    this.frames++;
    return STOP.FRAME;
  }
  audio(rate: number): Float32Array {
    expect(rate).toBe(44100);
    return new Float32Array(this.samplesPerFrame);
  }
}

class FakeAudio implements LoopAudio {
  readonly sampleRate = 44100;
  buffered = 0;                         // en muestras
  pushes = 0;
  suspended = 0;
  resumed = 0;
  push(s: Float32Array): void { this.buffered += s.length; this.pushes++; }
  bufferedMs(): number { return (this.buffered * 1000) / this.sampleRate; }
  drain(ms: number): void { this.buffered = Math.max(0, this.buffered - (ms * this.sampleRate) / 1000); }
  async suspend(): Promise<void> { this.suspended++; }
  async resume(): Promise<void> { this.resumed++; }
}

class FakeClock {
  t = 0;
  pending: ((t: number) => void)[] = [];
  now(): number { return this.t; }
  raf(cb: (t: number) => void): void { this.pending.push(cb); }
  /** Avanza ms y dispara los rAF pendientes (uno por "vsync"). */
  advance(ms: number): void {
    this.t += ms;
    const p = this.pending;
    this.pending = [];
    for (const cb of p) cb(this.t);
  }
}

function setup() {
  const core = new FakeCore();
  const clock = new FakeClock();
  const loop = new Loop(core, clock);
  const frames: number[] = [];
  loop.events.on("frame", (n) => frames.push(n));
  loop.start();
  return { core, clock, loop, frames };
}

describe("Loop: reloj de 50,08 Hz sin audio", () => {
  it("FRAME_MS = 69888 T a 3,5 MHz", () => {
    expect(FRAME_MS).toBeCloseTo(EXPECTED_FRAME_MS, 12);
    expect(1000 / FRAME_MS).toBeCloseTo(50.08, 2);
  });

  it("a 60 Hz de rAF emula 50,08 frames/s (10 s)", () => {
    const { core, clock } = setup();
    for (let i = 0; i < 600; i++) clock.advance(1000 / 60);
    expect(core.frames).toBe(Math.floor(10000 / EXPECTED_FRAME_MS)); // 500
  });

  it("a 144 Hz de rAF también (sin frames de más)", () => {
    const { core, clock } = setup();
    for (let i = 0; i < 1440; i++) clock.advance(1000 / 144);
    expect(Math.abs(core.frames - 10000 / EXPECTED_FRAME_MS)).toBeLessThan(1);
  });

  it("tras un parón largo no se recupera el retraso (tope por tick)", () => {
    const { core, clock, frames } = setup();
    clock.advance(5000);
    expect(core.frames).toBeLessThanOrEqual(MAX_FRAMES_PER_TICK);
    expect(frames).toEqual([core.frames]);
    const before = core.frames;
    clock.advance(1000 / 60);
    expect(core.frames - before).toBeLessThanOrEqual(1);
  });

  it("emite estadísticas de fps una vez por segundo", () => {
    const { clock, loop } = setup();
    const stats: { fps: number; audioMs: number | null }[] = [];
    loop.events.on("stats", (s) => stats.push(s));
    for (let i = 0; i < 121; i++) clock.advance(1000 / 60); // 120×16,67 queda a 1e-12 de 2000
    expect(stats.length).toBe(2);
    expect(stats[1]!.fps).toBeCloseTo(50.08, 0);
    expect(stats[1]!.audioMs).toBeNull();
  });
});

describe("Loop: audio como reloj maestro", () => {
  it("llena el buffer hasta el objetivo y para", () => {
    const { core, clock, loop } = setup();
    const audio = new FakeAudio();
    loop.setAudio(audio);
    clock.advance(16);
    // 882 muestras = 20 ms por frame: 0, 20, 40, 60 < 70 → 4 frames → 80 ms.
    expect(core.frames).toBe(Math.ceil(TARGET_MS / ((882 * 1000) / 44100)));
    expect(audio.pushes).toBe(core.frames);
    expect(audio.bufferedMs()).toBeGreaterThanOrEqual(TARGET_MS);
    const before = core.frames;
    clock.advance(16);                       // el DAC no ha consumido nada
    expect(core.frames).toBe(before);
    expect(loop.audioClock).toBe(true);
  });

  it("sigue el consumo del DAC, no el rAF", () => {
    const { core, clock, loop } = setup();
    const audio = new FakeAudio();
    loop.setAudio(audio);
    clock.advance(16);
    const start = core.frames;
    // 10 s de rAF a 60 Hz, el DAC consume exactamente lo que pasa en tiempo real.
    for (let i = 0; i < 600; i++) { audio.drain(1000 / 60); clock.advance(1000 / 60); }
    const ms = ((core.frames - start) * 882 * 1000) / 44100;
    expect(Math.abs(ms - 10000)).toBeLessThanOrEqual(20);
    expect(audio.bufferedMs()).toBeLessThan(TARGET_MS + 20);
  });

  it("un buffer que no se llena (muestras diminutas) no dispara frames sin tope", () => {
    const { core, clock, loop } = setup();
    core.samplesPerFrame = 1;
    loop.setAudio(new FakeAudio());
    clock.advance(16);
    expect(core.frames).toBe(MAX_FRAMES_PER_TICK);
  });

  it("si el núcleo no da muestras, vuelve al reloj de 50,08 Hz", () => {
    const { core, clock, loop } = setup();
    core.samplesPerFrame = 0;
    const audio = new FakeAudio();
    loop.setAudio(audio);
    clock.advance(16);
    expect(loop.audioClock).toBe(false);
    const start = core.frames;
    for (let i = 0; i < 600; i++) clock.advance(1000 / 60);
    expect(core.frames - start).toBe(Math.floor(10000 / EXPECTED_FRAME_MS));
    expect(audio.pushes).toBe(0);
    // Y si vuelven las muestras, retoma el reloj de audio.
    core.samplesPerFrame = 882;
    clock.advance(1000 / 60); clock.advance(1000 / 60);
    expect(loop.audioClock).toBe(true);
  });

  it("stats con audio informan los ms de buffer", () => {
    const { clock, loop } = setup();
    const audio = new FakeAudio();
    loop.setAudio(audio);
    const stats: (number | null)[] = [];
    loop.events.on("stats", (s) => stats.push(s.audioMs));
    for (let i = 0; i < 61; i++) { audio.drain(1000 / 60); clock.advance(1000 / 60); }
    expect(stats.length).toBe(1);
    expect(stats[0]).not.toBeNull();
  });
});

describe("Loop: pausa", () => {
  it("breakpoint: pausa, emite el evento una vez y no emula más hasta continuar", () => {
    const { core, clock, loop } = setup();
    core.breakAt.add(3);
    let bps = 0;
    const paused: boolean[] = [];
    loop.events.on("breakpoint", () => bps++);
    loop.events.on("paused", (p) => paused.push(p));
    for (let i = 0; i < 30; i++) clock.advance(1000 / 60);
    expect(core.frames).toBe(3);
    expect(bps).toBe(1);
    expect(loop.isPaused).toBe(true);
    expect(paused).toEqual([true]);
    loop.setPaused(false);
    expect(paused).toEqual([true, false]);
    for (let i = 0; i < 30; i++) clock.advance(1000 / 60);
    expect(core.frames).toBeGreaterThan(20);
    expect(bps).toBe(1);
  });

  it("breakpoint con audio: no empuja muestras de un frame a medias", () => {
    const { core, clock, loop } = setup();
    const audio = new FakeAudio();
    loop.setAudio(audio);
    core.breakAt.add(1);
    clock.advance(16);
    expect(core.frames).toBe(1);
    expect(audio.pushes).toBe(1);
    expect(loop.isPaused).toBe(true);
    expect(audio.suspended).toBe(1);
  });

  it("pausa del usuario y pestaña oculta son independientes", () => {
    const { core, clock, loop } = setup();
    loop.setHidden(true);
    for (let i = 0; i < 60; i++) clock.advance(1000 / 60);
    expect(core.frames).toBe(0);
    loop.setPaused(true);
    loop.setHidden(false);                   // vuelve la pestaña, sigue en pausa del usuario
    for (let i = 0; i < 60; i++) clock.advance(1000 / 60);
    expect(core.frames).toBe(0);
    loop.setPaused(false);
    for (let i = 0; i < 60; i++) clock.advance(1000 / 60);
    expect(core.frames).toBeGreaterThanOrEqual(49);
    expect(core.frames).toBeLessThanOrEqual(51);
  });

  it("al volver de la pausa no hay ráfaga de frames atrasados", () => {
    const { core, clock, loop } = setup();
    loop.setPaused(true);
    for (let i = 0; i < 300; i++) clock.advance(1000 / 60);
    loop.setPaused(false);
    clock.advance(1000 / 60);
    expect(core.frames).toBeLessThanOrEqual(1);
  });

  it("pausa con audio suspende el contexto y continuar lo reanuda", () => {
    const { loop } = setup();
    const audio = new FakeAudio();
    loop.setAudio(audio);
    loop.setPaused(true);
    loop.setPaused(false);
    expect(audio.suspended).toBe(1);
    expect(audio.resumed).toBe(1);
  });
});
