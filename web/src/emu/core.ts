// Envoltorio tipado de core.wasm (ABI: core/include/zx.h). Sin dependencias del DOM:
// lo usan tanto la web como los tests en Node.
import { RegsView } from "./regs";

export const FB_WIDTH = 352;
export const FB_HEIGHT = 296;
export const TSTATES_PER_FRAME = 69888;
export const CPU_HZ = 3_500_000;

export const STOP = { FRAME: 0, BREAKPOINT: 1, STEP: 2 } as const;

export interface CoreExports {
  memory: WebAssembly.Memory;
  zx_init(): void;
  zx_load_rom(len: number): number;
  zx_reset(): void;
  zx_set_issue(issue: number): void;
  zx_run_frame(): number;
  zx_step(): number;
  zx_tstate(): number;
  zx_frame_count(): number;
  zx_framebuffer(): number;
  zx_ram(): number;
  zx_regs(): number;
  zx_io_buffer(): number;
  zx_io_buffer_size(): number;
  zx_audio_render(rate: number): number;
  zx_audio_buffer(): number;
  zx_key(row: number, bit: number, down: number): void;
  zx_load_tap(len: number): number;
  zx_load_sna(len: number): number;
  zx_load_z80(len: number): number;
  zx_save_sna(): number;
  zx_bp_set(addr: number, on: number): void;
  zx_bp_clear_all(): void;
  zx_poke(addr: number, value: number): void;
  zx_set_pc(addr: number): void;
}

export const CORE_EXPORTS: (keyof CoreExports)[] = [
  "memory", "zx_init", "zx_load_rom", "zx_reset", "zx_set_issue", "zx_run_frame", "zx_step",
  "zx_tstate", "zx_frame_count", "zx_framebuffer", "zx_ram", "zx_regs", "zx_io_buffer",
  "zx_io_buffer_size", "zx_audio_render", "zx_audio_buffer", "zx_key", "zx_load_tap",
  "zx_load_sna", "zx_load_z80", "zx_save_sna", "zx_bp_set", "zx_bp_clear_all", "zx_poke",
  "zx_set_pc",
];

export class Core {
  readonly x: CoreExports;
  readonly regs: RegsView;

  constructor(instance: WebAssembly.Instance) {
    this.x = instance.exports as unknown as CoreExports;
    this.x.zx_init();
    this.regs = new RegsView(this.x.memory, this.x.zx_regs());
  }

  static async load(bytes: BufferSource): Promise<Core> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new Core(instance);
  }

  // La memoria del wasm no crece (todo es estático), así que las vistas son estables;
  // aun así se crean bajo demanda por si algún día lo hiciera.
  get mem(): Uint8Array { return new Uint8Array(this.x.memory.buffer); }
  ram(): Uint8Array { return new Uint8Array(this.x.memory.buffer, this.x.zx_ram(), 65536); }
  // La memoria del núcleo nunca es compartida (no usa hilos): es un ArrayBuffer normal.
  framebuffer(): Uint8ClampedArray<ArrayBuffer> {
    const buf = this.x.memory.buffer as ArrayBuffer;
    return new Uint8ClampedArray(buf, this.x.zx_framebuffer(), FB_WIDTH * FB_HEIGHT * 4);
  }

  /** Copia un fichero al buffer de E/S del núcleo y devuelve su longitud. */
  private put(data: Uint8Array): number {
    const size = this.x.zx_io_buffer_size();
    if (data.length > size) throw new Error(`fichero demasiado grande (${data.length} > ${size})`);
    this.mem.set(data, this.x.zx_io_buffer());
    return data.length;
  }

  loadRom(rom: Uint8Array): void {
    if (this.x.zx_load_rom(this.put(rom)) !== 0) throw new Error("ROM inválida (debe ocupar 16384 bytes)");
    this.x.zx_reset();
  }
  loadTap(d: Uint8Array): number { return this.x.zx_load_tap(this.put(d)); }
  loadSna(d: Uint8Array): number { return this.x.zx_load_sna(this.put(d)); }
  loadZ80(d: Uint8Array): number { return this.x.zx_load_z80(this.put(d)); }
  saveSna(): Uint8Array {
    const n = this.x.zx_save_sna();
    return this.mem.slice(this.x.zx_io_buffer(), this.x.zx_io_buffer() + n);
  }

  runFrame(): number { return this.x.zx_run_frame(); }

  audio(rate: number): Float32Array {
    const n = this.x.zx_audio_render(rate);
    return new Float32Array(this.x.memory.buffer, this.x.zx_audio_buffer(), n);
  }
}
