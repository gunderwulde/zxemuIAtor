// Envoltorio de core-probe.wasm (máquina 48K real + hooks zx_t_*) para los tests
// ULA-*, SYS-* y CPU-21. Sólo da acceso; no calcula ningún valor esperado.
import { Core, type CoreExports } from "../../web/src/emu/core";
import type { Reg16, Reg8 } from "../../web/src/emu/regs";
import { instantiate, rom48 } from "./wasm";

export interface ProbeExports extends CoreExports {
  zx_t_set_tstate(t: number): void;
  zx_t_contention(t: number): number;
  zx_t_run_until(t: number): number;
  zx_t_set_int_enabled(on: number): void;
  zx_t_buslog_enable(on: number): void;
  zx_t_buslog(): number;
  zx_t_buslog_len(): number;
  zx_t_beeper_log(): number;
  zx_t_beeper_log_len(): number;
}

export const EV = { MC: 0, MR: 1, MW: 2, PR: 3, PW: 4, PC: 5 } as const;
export interface BusEvent { t: number; addr: number; kind: number; value: number }

export class Probe extends Core {
  declare readonly x: ProbeExports;

  static async create(withRom = true): Promise<Probe> {
    const p = new Probe(await instantiate("core-probe"));
    if (withRom) p.loadRom(rom48());
    return p;
  }

  get t(): number { return this.x.zx_tstate(); }
  set t(v: number) { this.x.zx_t_set_tstate(v); }

  poke(addr: number, bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.x.zx_poke((addr + i) & 0xffff, bytes[i]!);
  }

  /** Fija registros. Las claves de 16 bits y de 8 bits son las de regs.ts. */
  setRegs(r: Partial<Record<Reg16 | Reg8, number>>): void {
    for (const [k, v] of Object.entries(r)) {
      if (v === undefined) continue;
      if (k === "pc") this.x.zx_set_pc(v);
      else if (["i", "r", "iff1", "iff2", "im", "halted", "q", "ei_delay", "ld_air"].includes(k)) this.regs.set8(k as Reg8, v);
      else this.regs.set16(k as Reg16, v);
    }
  }

  /** Ejecuta una instrucción (zx_step) y devuelve los T consumidos. */
  step(): number {
    const t0 = this.t;
    this.x.zx_step();
    return this.t - t0;
  }

  buslog(): BusEvent[] {
    const n = this.x.zx_t_buslog_len();
    const dv = new DataView(this.x.memory.buffer, this.x.zx_t_buslog(), n * 8);
    const out: BusEvent[] = [];
    for (let i = 0; i < n; i++) {
      out.push({ t: dv.getUint32(i * 8, true), addr: dv.getUint16(i * 8 + 4, true), kind: dv.getUint8(i * 8 + 6), value: dv.getUint8(i * 8 + 7) });
    }
    return out;
  }

  /** Pares (t, nivel) del log del beeper del frame actual. */
  beeperLog(): Array<{ t: number; level: number }> {
    const n = this.x.zx_t_beeper_log_len();
    const u = new Uint32Array(this.x.memory.buffer, this.x.zx_t_beeper_log(), n * 2);
    const out = [];
    for (let i = 0; i < n; i++) out.push({ t: u[i * 2]!, level: u[i * 2 + 1]! });
    return out;
  }

  /** Copia del framebuffer actual. */
  fb(): Uint8Array { return new Uint8Array(this.framebuffer()); }
}

/**
 * ¿Hay CPU real? El stub de fase 0 ejecuta todo como NOP. Se comprueba con LD A,n:
 * si A no cambia, la CPU no existe todavía y los tests que dependen de C1 fallarán
 * (se dejan fallar a propósito, con este diagnóstico en el mensaje).
 */
export async function cpuPresent(): Promise<boolean> {
  const p = await Probe.create(false);
  p.x.zx_t_set_int_enabled(0);
  p.poke(0x8000, [0x3e, 0x5a]); // LD A,0x5A
  p.setRegs({ pc: 0x8000, af: 0 });
  p.step();
  return p.regs.get16("af") >> 8 === 0x5a;
}
