// Bucle de emulación.
//
// Con audio, el reloj maestro es la tarjeta de sonido: se emulan frames mientras el
// buffer de salida tenga menos de TARGET_MS. Así la emulación nunca se adelanta ni se
// atrasa respecto al DAC y no hay cortes ni deriva. Sin audio (aún no hubo gesto del
// usuario, falló o el núcleo no da muestras), un acumulador sobre requestAnimationFrame
// emula a 50,08 Hz (69888 T a 3,5 MHz = 19,968 ms por frame).
import { CPU_HZ, STOP, TSTATES_PER_FRAME } from "./core";

export const FRAME_MS = (1000 * TSTATES_PER_FRAME) / CPU_HZ;
export const TARGET_MS = 70;
/** Tope de frames por tick: tras un parón (pestaña congelada, depurador) no se recupera. */
export const MAX_FRAMES_PER_TICK = 5;
const MAX_DT = 250;

export interface LoopCore {
  runFrame(): number;
  audio(rate: number): Float32Array;
}

/** Lo que el bucle necesita de AudioOut (web/src/emu/audio.ts, M2). */
export interface LoopAudio {
  readonly sampleRate: number;
  push(samples: Float32Array): void;
  bufferedMs(): number;
  suspend(): Promise<void>;
  resume(): Promise<void>;
}

export interface Clock {
  now(): number;
  raf(cb: (t: number) => void): void;
}

// ---- Bus de eventos tipado (D1 se engancha a "breakpoint" en la fase 2) ----

export type Listener<T> = (payload: T) => void;

export class Emitter<E> {
  private h: { [K in keyof E]?: Listener<E[K]>[] } = {};
  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    (this.h[type] ??= []).push(fn);
    return () => {
      const a = this.h[type];
      const i = a ? a.indexOf(fn) : -1;
      if (i >= 0) a!.splice(i, 1);
    };
  }
  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const a = this.h[type];
    if (a) for (const fn of a.slice()) fn(payload);
  }
}

export interface LoopStats {
  /** Frames emulados por segundo de reloj de pared. */
  fps: number;
  /** ms en el buffer de audio, o null si el bucle no va con audio. */
  audioMs: number | null;
}

export interface LoopEvents {
  /** Se han emulado n frames en este tick (hay que repintar). */
  frame: number;
  /** El núcleo paró en un breakpoint; el bucle queda en pausa. */
  breakpoint: void;
  /** Cambio de estado de pausa (por el usuario o por breakpoint). */
  paused: boolean;
  /** Una vez por segundo aproximadamente. */
  stats: LoopStats;
}

const browserClock: Clock = {
  now: () => performance.now(),
  raf: (cb) => { requestAnimationFrame(cb); },
};

export class Loop {
  readonly events = new Emitter<LoopEvents>();
  private audio: LoopAudio | null = null;
  /** El núcleo entrega muestras: sólo entonces el audio puede ser reloj maestro. */
  private audioOk = false;
  private paused = false;
  private hidden = false;
  private started = false;
  private last = 0;
  private acc = 0;
  private statFrames = 0;
  private statStart = 0;

  constructor(private core: LoopCore, private clock: Clock = browserClock) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.last = this.statStart = this.clock.now();
    this.clock.raf(this.tick);
  }

  get isPaused(): boolean { return this.paused; }
  get audioClock(): boolean { return this.audio !== null && this.audioOk; }

  setAudio(a: LoopAudio | null): void {
    this.audio = a;
    this.audioOk = a !== null;
    this.acc = 0;
  }

  setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.paused = p;
    this.acc = 0;
    this.syncAudio();
    this.events.emit("paused", p);
  }

  /** Pestaña oculta: pausa independiente de la del usuario. */
  setHidden(h: boolean): void {
    if (h === this.hidden) return;
    this.hidden = h;
    this.acc = 0;
    this.syncAudio();
  }

  private get running(): boolean { return !this.paused && !this.hidden; }

  private syncAudio(): void {
    const a = this.audio;
    if (!a) return;
    (this.running ? a.resume() : a.suspend()).catch(() => {});
  }

  /** Un tick: lo llama requestAnimationFrame (o los tests con un reloj falso). */
  readonly tick = (now: number): void => {
    this.clock.raf(this.tick);
    const dt = Math.min(Math.max(now - this.last, 0), MAX_DT);
    this.last = now;
    let n = 0;
    if (this.running) {
      if (this.audioClock) {
        const a = this.audio!;
        while (n < MAX_FRAMES_PER_TICK && a.bufferedMs() < TARGET_MS) {
          if (!this.frame()) break;
          n++;
          if (!this.audioOk) break; // el núcleo dejó de dar muestras: al acumulador
        }
      } else {
        this.acc += dt;
        while (this.acc >= FRAME_MS && n < MAX_FRAMES_PER_TICK) {
          this.acc -= FRAME_MS;
          if (!this.frame()) break;
          n++;
          if (this.audioClock) { this.acc = 0; break; } // vuelve el reloj de audio
        }
        if (this.acc >= FRAME_MS) this.acc = 0; // retraso irrecuperable: se descarta
      }
    }
    if (n > 0) this.events.emit("frame", n);
    this.statFrames += n;
    const el = now - this.statStart;
    if (el >= 1000) {
      this.events.emit("stats", {
        fps: (this.statFrames * 1000) / el,
        audioMs: this.audioClock ? this.audio!.bufferedMs() : null,
      });
      this.statFrames = 0;
      this.statStart = now;
    }
  };

  /** Emula un frame. false si paró en un breakpoint. */
  private frame(): boolean {
    if (this.core.runFrame() === STOP.BREAKPOINT) {
      // El frame queda a medias; su audio se entrega al completarlo tras continuar.
      this.setPaused(true);
      this.events.emit("breakpoint", undefined);
      return false;
    }
    const a = this.audio;
    if (a) {
      const s = this.core.audio(a.sampleRate);
      this.audioOk = s.length > 0;
      if (s.length > 0) a.push(s);
    }
    return true;
  }
}
