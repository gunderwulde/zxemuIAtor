// Trazado por instrucción con core-probe: marca cada byte como ejecutado (X), leído como
// dato (R) o escrito (W). El número de bytes de cada instrucción sale del desensamblador.
import type { Core } from "../../web/src/emu/core";
import { disassemble } from "../../web/src/disasm";

export const X = 1, R = 2, W = 4, OPND = 8;

export interface ProbeX { zx_t_buslog_enable(on: number): void; zx_t_buslog(): number; zx_t_buslog_len(): number }

export class Tracer {
  flags = new Uint8Array(65536);
  /** Primera instrucción de cada byte ejecutado: dirección de inicio (para saber dónde empieza cada instrucción). */
  starts = new Uint8Array(65536);
  steps = 0;
  private px: ProbeX;
  constructor(private core: Core) { this.px = core.x as unknown as ProbeX; }

  /** Ejecuta n instrucciones registrando. Para en los breakpoints sin ejecutarlos (devuelve 1). */
  run(n: number, onStep?: (pc: number) => void): void {
    const c = this.core, f = this.flags, ram = c.ram();
    for (let i = 0; i < n; i++) {
      const pc = c.regs.get16("pc");
      onStep?.(pc);
      const line = disassemble(ram, pc);
      this.px.zx_t_buslog_enable(1);
      c.x.zx_step();
      const len = line.len;
      this.starts[pc] = 1;
      for (let k = 0; k < len; k++) f[(pc + k) & 0xffff]! |= k === 0 ? X : X | OPND;
      const cnt = this.px.zx_t_buslog_len();
      const dv = new DataView(c.x.memory.buffer, this.px.zx_t_buslog(), cnt * 8);
      for (let e = 0; e < cnt; e++) {
        const kind = dv.getUint8(e * 8 + 6), addr = dv.getUint16(e * 8 + 4, true);
        const rel = (addr - pc) & 0xffff;
        if (kind === 1 && rel >= len) f[addr]! |= R;
        else if (kind === 2) f[addr]! |= W;
      }
      this.steps++;
    }
    this.px.zx_t_buslog_enable(0);
  }

  /** Ejecuta un frame completo instrucción a instrucción (hasta que cambia el contador de frames). */
  frame(onStep?: (pc: number) => void): void {
    const c = this.core, f0 = c.x.zx_frame_count();
    while (c.x.zx_frame_count() === f0) this.run(1, onStep);
  }
}
