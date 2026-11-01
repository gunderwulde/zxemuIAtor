// Salida de audio del beeper (M2): AudioContext + AudioWorklet con ring buffer.
//
// El reloj maestro de la emulación es el audio (docs/zx48-hardware.md §12): el bucle
// (W1) produce frames mientras bufferedMs() < AUDIO_TARGET_MS y para en cuanto lo
// supera. Con frames de ~20 ms el relleno oscila entre 60 y ~80 ms: margen suficiente
// para absorber un GC o un frame de rAF perdido (~16-33 ms) sin underrun, y latencia
// percibida baja. Bajar de ~40 ms produce huecos en máquinas lentas; subir de ~120 ms
// se nota al pulsar teclas.
//
// Mientras el contexto está suspendido (antes de start() o tras suspend()) el worklet
// no consume: bufferedMs() se queda quieto en el objetivo y el bucle se detiene solo.
// Si W1 quiere emular sin audio arrancado necesita otro reloj para ese caso.
//
// Transporte: con crossOriginIsolated se comparte un SharedArrayBuffer (índices con
// Atomics, sin mensajes); si no, se envían bloques por postMessage y el worklet informa
// del relleno cada ~10 ms (bufferedMs() es entonces una estimación).
//
// Overflow: se descarta lo más antiguo (el productor adelanta el índice de lectura).
// Underrun: el worklet rellena con el último valor decayendo a 0 (silencio, sin clic).
import type { BeeperOptions, FromWorklet, ToWorklet } from "./audio-worklet";
// "?worker&url": Vite compila el worklet como chunk aparte (TS → JS) y devuelve su URL.
// OJO: new URL("./audio-worklet.ts", import.meta.url) funciona en dev pero en
// `vite build` copia el .ts SIN transpilar como asset y addModule falla en producción
// (comprobado con Vite 8.3.5).
import WORKLET_URL from "./audio-worklet.ts?worker&url";

/** Relleno objetivo recomendado para el bucle de emulación (ms). */
export const AUDIO_TARGET_MS = 60;
/** Capacidad mínima del ring (ms); se redondea a potencia de 2 en muestras. */
export const AUDIO_CAPACITY_MS = 250;

// Mismo layout que audio-worklet.ts (no se importa: ver allí).
const CTL_WRITE = 0;
const CTL_READ = 1;
const CTL_SIZE = 4;

export class AudioOut {
  readonly sampleRate: number;
  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  private readonly node: AudioWorkletNode;
  private readonly cap: number;
  private readonly mask: number;
  // Modo compartido
  private readonly ctl: Int32Array | null;
  private readonly data: Float32Array | null;
  // Modo mensajes
  private pushed = 0;
  private report: FromWorklet = { type: "fill", fill: 0, received: 0, time: 0, underruns: 0 };

  private constructor(ctx: AudioContext, node: AudioWorkletNode, gain: GainNode, cap: number,
                      ctl: Int32Array | null, data: Float32Array | null) {
    this.ctx = ctx;
    this.node = node;
    this.gain = gain;
    this.cap = cap;
    this.mask = cap - 1;
    this.ctl = ctl;
    this.data = data;
    this.sampleRate = ctx.sampleRate;
    if (!ctl) this.node.port.onmessage = (e: MessageEvent<FromWorklet>) => { this.report = e.data; };
  }

  /** Crea el contexto y carga el worklet sin arrancarlo (no requiere gesto). */
  static async create(): Promise<AudioOut> {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    if (ctx.state === "running") await ctx.suspend();
    await ctx.audioWorklet.addModule(WORKLET_URL);
    let cap = 1;
    while (cap < (ctx.sampleRate * AUDIO_CAPACITY_MS) / 1000) cap *= 2;
    const shared = typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated === true;
    const opts: BeeperOptions = { capacity: cap };
    let ctl: Int32Array | null = null, data: Float32Array | null = null;
    if (shared) {
      opts.ctl = new SharedArrayBuffer(CTL_SIZE * 4);
      opts.data = new SharedArrayBuffer(cap * 4);
      ctl = new Int32Array(opts.ctl);
      data = new Float32Array(opts.data);
    }
    const node = new AudioWorkletNode(ctx, "zx-beeper", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: opts,
    });
    const gain = new GainNode(ctx, { gain: 1 });
    node.connect(gain).connect(ctx.destination);
    return new AudioOut(ctx, node, gain, cap, ctl, data);
  }

  /** Arranca el audio. Llamar desde un gesto del usuario (política de autoplay). */
  start(): Promise<void> { return this.ctx.resume(); }
  suspend(): Promise<void> { return this.ctx.suspend(); }
  resume(): Promise<void> { return this.ctx.resume(); }

  setMuted(m: boolean): void {
    // Rampa corta: cortar la ganancia de golpe produce un clic. El worklet sigue
    // consumiendo, así que el reloj de emulación no cambia al silenciar.
    this.gain.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.005);
  }

  /** Encola una copia de las muestras (la vista puede apuntar a la memoria del wasm). */
  push(samples: Float32Array): void {
    let s = samples;
    if (s.length === 0) return;
    if (!this.ctl || !this.data) {
      this.pushed += s.length;
      const msg: ToWorklet = { type: "push", data: s.slice() };
      this.node.port.postMessage(msg, [msg.data.buffer]);
      return;
    }
    const ctl = this.ctl, cap = this.cap;
    if (s.length > cap) s = s.subarray(s.length - cap);
    const w = ctl[CTL_WRITE]!;   // sólo lo escribe este hilo
    // Overflow: adelantar la lectura para descartar lo más antiguo. CAS porque el
    // worklet puede estar avanzándola a la vez; si gana él, se recalcula.
    for (;;) {
      const r = Atomics.load(ctl, CTL_READ);
      const fill = (w - r) >>> 0;
      if (fill + s.length <= cap) break;
      const nr = (w + s.length - cap) | 0;
      if (Atomics.compareExchange(ctl, CTL_READ, r, nr) === r) break;
    }
    const at = w & this.mask;
    const first = Math.min(s.length, cap - at);
    this.data.set(s.subarray(0, first), at);
    if (first < s.length) this.data.set(s.subarray(first), 0);
    Atomics.store(ctl, CTL_WRITE, (w + s.length) | 0);
  }

  /** Relleno actual del ring en ms (sin contar la latencia de salida del sistema). */
  bufferedMs(): number {
    let fill: number;
    if (this.ctl) {
      fill = (Atomics.load(this.ctl, CTL_WRITE) - Atomics.load(this.ctl, CTL_READ)) >>> 0;
    } else {
      // Último informe del worklet + lo enviado después − lo consumido desde entonces.
      const inFlight = this.pushed - this.report.received;
      const consumed = this.ctx.state === "running"
        ? Math.max(0, (this.ctx.currentTime - this.report.time) * this.sampleRate) : 0;
      fill = Math.max(inFlight, this.report.fill + inFlight - consumed);
      fill = Math.min(fill, this.cap + inFlight);
    }
    return (fill * 1000) / this.sampleRate;
  }
}
