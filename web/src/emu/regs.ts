// Espejo TypeScript de ZxRegs (core/include/zx.h). Mismos offsets; un test lo verifica.

export const REG = {
  af: 0, bc: 2, de: 4, hl: 6,
  af_: 8, bc_: 10, de_: 12, hl_: 14,
  ix: 16, iy: 18, sp: 20, pc: 22,
  memptr: 24,
  i: 26, r: 27,
  iff1: 28, iff2: 29, im: 30, halted: 31,
  q: 32, ei_delay: 33, ld_air: 34,
} as const;

export const REGS_SIZE = 36;

export type Reg16 = "af" | "bc" | "de" | "hl" | "af_" | "bc_" | "de_" | "hl_" | "ix" | "iy" | "sp" | "pc" | "memptr";
export type Reg8 = "i" | "r" | "iff1" | "iff2" | "im" | "halted" | "q" | "ei_delay" | "ld_air";

export type RegsSnapshot = Record<Reg16 | Reg8, number>;

const R16: Reg16[] = ["af", "bc", "de", "hl", "af_", "bc_", "de_", "hl_", "ix", "iy", "sp", "pc", "memptr"];
const R8: Reg8[] = ["i", "r", "iff1", "iff2", "im", "halted", "q", "ei_delay", "ld_air"];

/** Vista sobre el struct de registros dentro de la memoria del wasm (sin copias). */
export class RegsView {
  private dv: DataView;
  constructor(memory: WebAssembly.Memory, ptr: number) {
    this.dv = new DataView(memory.buffer, ptr, REGS_SIZE);
  }
  get16(r: Reg16): number { return this.dv.getUint16(REG[r], true); }
  set16(r: Reg16, v: number): void { this.dv.setUint16(REG[r], v, true); }
  get8(r: Reg8): number { return this.dv.getUint8(REG[r]); }
  set8(r: Reg8, v: number): void { this.dv.setUint8(REG[r], v); }

  snapshot(): RegsSnapshot {
    const s = {} as RegsSnapshot;
    for (const r of R16) s[r] = this.get16(r);
    for (const r of R8) s[r] = this.get8(r);
    return s;
  }
}
