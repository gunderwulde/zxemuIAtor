// AudioOut + worklet en Node con un Web Audio simulado (sin navegador): ring buffer,
// overflow, underrun y el reloj de audio como maestro durante 60 s simulados.
// Lo que NO cubre: el AudioContext real, la latencia del sistema y los dos modos
// dentro de un navegador (comprobación manual pendiente, ver informe de M2).
import { beforeAll, describe, expect, it } from "vitest";

const RATE = 48000;
const QUANTUM = 128;

type Proc = { process(i: Float32Array[][], o: Float32Array[][]): boolean; port: FakePort };
let ProcCtor: new (o: { processorOptions: unknown }) => Proc;
let lastNode: FakeNode;
let now = 0;   // currentTime simulado (s)

class FakePort {
  other: FakePort | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  queue: unknown[] = [];
  // Entrega diferida: los mensajes llegan en el siguiente "tick" (como entre hilos).
  postMessage(data: unknown): void { this.other!.queue.push(data); }
  flush(): void { const q = this.queue; this.queue = []; for (const d of q) this.onmessage?.({ data: d }); }
}

class FakeNode {
  port = new FakePort();
  proc: Proc;
  constructor(_ctx: unknown, _name: string, opts: { processorOptions: unknown }) {
    this.proc = new ProcCtor({ processorOptions: opts.processorOptions });
    this.port.other = this.proc.port;
    this.proc.port.other = this.port;
    lastNode = this;
  }
  connect<T>(n: T): T { return n; }
  /** Un bloque de render del worklet; devuelve su salida. */
  render(): Float32Array {
    this.proc.port.flush();
    const out = new Float32Array(QUANTUM);
    this.proc.process([], [[out]]);
    now += QUANTUM / RATE;
    (globalThis as Record<string, unknown>).currentTime = now;
    this.port.flush();
    return out;
  }
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = RATE;
  g.currentTime = 0;
  g.AudioWorkletProcessor = class { port = new FakePort(); };
  g.registerProcessor = (_n: string, c: typeof ProcCtor) => { ProcCtor = c; };
  g.AudioWorkletNode = FakeNode;
  g.GainNode = class { gain = { setTargetAtTime() {} }; connect<T>(n: T) { return n; } };
  g.AudioContext = class {
    sampleRate = RATE; state = "suspended"; destination = {};
    get currentTime() { return now; }
    audioWorklet = { addModule: async () => {} };
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
  };
  await import("../../../web/src/emu/audio-worklet");
});

async function make(shared: boolean) {
  (globalThis as Record<string, unknown>).crossOriginIsolated = shared;
  now = 0;
  const { AudioOut, AUDIO_TARGET_MS } = await import("../../../web/src/emu/audio");
  const a = await AudioOut.create();
  await a.start();
  return { a, node: lastNode, target: AUDIO_TARGET_MS };
}

const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => ((from + i) % 1000) / 1000);

for (const shared of [true, false]) {
  describe(`AudioOut (${shared ? "SharedArrayBuffer" : "postMessage"})`, () => {
    it("entrega exactamente lo empujado, en orden; bufferedMs refleja el relleno", async () => {
      const { a, node } = await make(shared);
      a.push(ramp(0, 960));
      a.push(ramp(960, 960));
      expect(a.bufferedMs()).toBeCloseTo(40, 1);
      const got: number[] = [];
      for (let i = 0; i < 15; i++) got.push(...node.render());
      expect(got).toEqual(Array.from(ramp(0, 1920)));
      expect(a.bufferedMs()).toBeCloseTo(0, 0);
    });

    it("push copia: modificar la vista después no altera el audio", async () => {
      const { a, node } = await make(shared);
      const v = new Float32Array(QUANTUM).fill(0.25);
      a.push(v);
      v.fill(-1);
      expect(Array.from(node.render())).toEqual(new Array(QUANTUM).fill(0.25));
    });

    it("overflow: descarta lo más antiguo y conserva lo más nuevo", async () => {
      const { a, node } = await make(shared);
      const cap = 16384;   // 250 ms a 48 kHz → potencia de 2
      a.push(ramp(0, cap));
      a.push(ramp(cap, 1000));
      node.render();   // entrega los mensajes en modo postMessage
      const out = node.render();
      // Tras descartar 1000, la lectura empieza en 1000 (+128 ya consumidos).
      expect(Array.from(out)).toEqual(Array.from(ramp(1000 + QUANTUM, QUANTUM)));
    });

    it("underrun: silencio que decae desde el último valor, sin ruido", async () => {
      const { a, node } = await make(shared);
      a.push(new Float32Array(64).fill(0.5));
      const out = node.render();
      expect(out[63]).toBe(0.5);
      for (let i = 64; i < QUANTUM; i++) {
        expect(Math.abs(out[i]!)).toBeLessThan(Math.abs(out[i - 1]!) + 1e-9);
        expect(out[i]!).toBeGreaterThanOrEqual(0);
      }
      const later = node.render();
      expect(Math.max(...later.map(Math.abs))).toBeLessThan(0.5 * Math.exp(-64 / (0.003 * RATE)));
    });

    it("60 s con el audio como maestro y un productor irregular: 0 huecos, nada perdido", async () => {
      const { a, node, target } = await make(shared);
      // Productor (como W1): se despierta cada 16,7 ms, a veces hasta 25 ms tarde (GC,
      // pestaña lenta), y produce frames de 69888 T a 48 kHz (958/959 muestras) mientras
      // el relleno esté por debajo del objetivo.
      let frac = 0, produced = 0, nextWake = 0, seed = 1, minFill = Infinity;
      const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
      const expected: number[] = [];
      const got: number[] = [];
      const produce = () => {
        while (a.bufferedMs() < target) {
          frac += 69888 * RATE;
          const n = Math.floor(frac / 3_500_000);
          frac -= n * 3_500_000;
          const s = ramp(produced, n);
          produced += n;
          for (const v of s) expected.push(v);
          a.push(s);
        }
      };
      const quanta = Math.floor((60 * RATE) / QUANTUM);
      for (let q = 0; q < quanta; q++) {
        if (now >= nextWake) {
          produce();
          nextWake = now + 1 / 60 + (rnd() < 0.05 ? 0.025 * rnd() : 0);
        }
        for (const v of node.render()) got.push(v);
        minFill = Math.min(minFill, a.bufferedMs());
      }
      // Un hueco (underrun) insertaría valores decayendo y un descarte saltaría
      // muestras: cualquiera de los dos rompe la igualdad exacta.
      expect(got.length).toBe(quanta * QUANTUM);
      let bad = -1;   // primera discrepancia (toEqual sobre 2,9 M elementos es lentísimo al fallar)
      for (let i = 0; i < got.length && bad < 0; i++) if (got[i] !== expected[i]) bad = i;
      expect(bad, bad >= 0 ? `muestra ${bad}: ${got[bad]} frente a ${expected[bad]}` : "").toBe(-1);
      expect(minFill).toBeGreaterThan(5);
      expect(a.bufferedMs()).toBeLessThan(target + 25);
    });
  });
}
