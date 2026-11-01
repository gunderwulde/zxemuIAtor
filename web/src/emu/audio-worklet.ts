// AudioWorklet del beeper (M2). Consume muestras mono de un ring buffer y las entrega
// en bloques de 128 al grafo de Web Audio. Dos transportes (ver audio.ts):
//  - SharedArrayBuffer (crossOriginIsolated): índices compartidos con Atomics, sin copias
//    entre hilos ni mensajes.
//  - postMessage: el hilo principal envía bloques; el ring vive aquí y se informa del
//    relleno periódicamente.
// Underrun: lo que falta se rellena con el último valor decayendo a 0 (~3 ms), así el
// hueco suena a silencio y no a un clic ni a ruido.
// Este fichero no importa nada: se carga como módulo independiente con addModule.
export {};

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  ctor: new (options: { processorOptions: BeeperOptions }) => AudioWorkletProcessor,
): void;

/** Layout de control compartido (Int32Array): índices en muestras, módulo 2^32.
 * Duplicado en audio.ts: importar valores de aquí ejecutaría registerProcessor en el
 * hilo principal (audio.ts sólo importa tipos). */
const CTL_WRITE = 0;     // lo avanza el productor (hilo principal)
const CTL_READ = 1;      // lo avanza el consumidor; el productor lo empuja al descartar
const CTL_UNDERRUN = 2;  // nº de bloques con hueco (diagnóstico)
const CTL_SIZE = 4;

export interface BeeperOptions {
  capacity: number;                     // potencia de 2
  ctl?: SharedArrayBuffer;              // modo compartido
  data?: SharedArrayBuffer;
}

/** Mensajes del modo postMessage. */
export type ToWorklet = { type: "push"; data: Float32Array };
export type FromWorklet = { type: "fill"; fill: number; received: number; time: number; underruns: number };

const DECAY = Math.exp(-1 / (0.003 * sampleRate));
const REPORT_EVERY = 4;   // bloques (≈10,7 ms a 48 kHz)

class BeeperProcessor extends AudioWorkletProcessor {
  private readonly cap: number;
  private readonly mask: number;
  private readonly ctl: Int32Array;
  private readonly data: Float32Array;
  private readonly shared: boolean;
  private last = 0;
  private received = 0;   // sólo modo mensajes
  private blocks = 0;

  constructor(options: { processorOptions: BeeperOptions }) {
    super();
    const o = options.processorOptions;
    this.cap = o.capacity;
    this.mask = o.capacity - 1;
    this.shared = !!(o.ctl && o.data);
    this.ctl = o.ctl ? new Int32Array(o.ctl) : new Int32Array(CTL_SIZE);
    this.data = o.data ? new Float32Array(o.data) : new Float32Array(o.capacity);
    if (!this.shared) this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.enqueue(e.data.data);
  }

  /** Modo mensajes: mismo ring, un solo hilo. Overflow → se descarta lo más antiguo. */
  private enqueue(s: Float32Array): void {
    this.received += s.length;
    if (s.length > this.cap) s = s.subarray(s.length - this.cap);
    const w = this.ctl[CTL_WRITE]!;
    const r = this.ctl[CTL_READ]!;
    const fill = (w - r) >>> 0;
    if (fill + s.length > this.cap) this.ctl[CTL_READ] = (w + s.length - this.cap) | 0;
    const at = w & this.mask;
    const first = Math.min(s.length, this.cap - at);
    this.data.set(s.subarray(0, first), at);
    if (first < s.length) this.data.set(s.subarray(first), 0);
    this.ctl[CTL_WRITE] = (w + s.length) | 0;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]![0]!;
    const ctl = this.ctl;
    const r = this.shared ? Atomics.load(ctl, CTL_READ) : ctl[CTL_READ]!;
    const w = this.shared ? Atomics.load(ctl, CTL_WRITE) : ctl[CTL_WRITE]!;
    const n = Math.min((w - r) >>> 0, out.length);
    const at = r & this.mask;
    const first = Math.min(n, this.cap - at);
    out.set(this.data.subarray(at, at + first), 0);
    if (first < n) out.set(this.data.subarray(0, n - first), first);
    if (n) this.last = out[n - 1]!;
    if (n < out.length) {
      let v = this.last;
      for (let i = n; i < out.length; i++) out[i] = v *= DECAY;
      this.last = v;
      if (this.shared) Atomics.add(ctl, CTL_UNDERRUN, 1); else ctl[CTL_UNDERRUN]!++;
    }
    if (this.shared) {
      // Si el productor ha descartado entretanto (overflow), su índice manda.
      Atomics.compareExchange(ctl, CTL_READ, r, (r + n) | 0);
    } else {
      ctl[CTL_READ] = (r + n) | 0;
      if (++this.blocks % REPORT_EVERY === 0) {
        const msg: FromWorklet = {
          type: "fill", fill: (ctl[CTL_WRITE]! - ctl[CTL_READ]!) >>> 0, received: this.received,
          time: currentTime, underruns: ctl[CTL_UNDERRUN]!,
        };
        this.port.postMessage(msg);
      }
    }
    return true;
  }
}

registerProcessor("zx-beeper", BeeperProcessor);
