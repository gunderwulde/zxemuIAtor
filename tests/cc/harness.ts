// Ejecuta un programa C en el núcleo real (core-probe.wasm con la ROM 48K): compila (K1),
// ensambla (A1), inyecta, y corre con zx_step hasta que crt0 vuelve. No calcula ningún
// valor esperado: solo da acceso a la memoria, los registros y los símbolos.
import { assemble, type AsmResult } from "../../web/src/asm";
import { compile, type CcOptions, type CcResult } from "../../web/src/cc";
import { TSTATES_PER_FRAME } from "../../web/src/emu/core";
import { Probe } from "../util/probe";

/** Dirección a la que vuelve el RET del crt0: un JR $ que el bucle detecta. */
export const SENTINEL = 0xfff0;
const SP0 = 0xff00;

export interface CRun {
  cc: CcResult;
  asm: AsmResult;
  /** BC al volver (= valor de main, como USR). */
  ret: number;
  /** T-states desde la entrada hasta el RET del crt0. */
  t: number;
  steps: number;
  ram: Uint8Array;
  sym(name: string): number;
  u8(name: string, i?: number): number;
  s8(name: string, i?: number): number;
  u16(name: string, i?: number): number;
  s16(name: string, i?: number): number;
  bytes: number;
  probe: Probe;
}

export function compileOk(src: string | Map<string, string>, opts: Partial<CcOptions> = {}): { cc: CcResult; asm: AsmResult } {
  const files = typeof src === "string" ? new Map([["main.c", src]]) : src;
  const cc = compile(files, { main: "main.c", ...opts });
  const errs = cc.errors.filter((e) => e.severity === "error");
  if (errs.length) throw new Error("errores de compilación:\n" + errs.map((e) => `${e.file}:${e.line}:${e.col}: ${e.msg}`).join("\n"));
  const asm = assemble(cc.asm);
  const aerr = asm.errors.filter((e) => e.severity === "error");
  if (aerr.length) {
    const lines = cc.asm.split("\n");
    throw new Error("errores de ensamblado:\n" + aerr.map((e) => `${e.line}:${e.col}: ${e.msg}\n    ${lines[e.line - 1]}`).join("\n"));
  }
  return { cc, asm };
}

let shared: Probe | null = null;

export async function runC(src: string | Map<string, string>, opts: Partial<CcOptions> & { maxSteps?: number; fill?: number } = {}): Promise<CRun> {
  const { cc, asm } = compileOk(src, opts);
  const p = shared ?? (shared = await Probe.create(true));
  p.x.zx_reset();
  p.x.zx_t_set_int_enabled(0);
  // RAM limpia y determinista entre programas.
  for (let a = 0x4000; a < 0x10000; a++) p.x.zx_poke(a, opts.fill ?? 0);
  for (const s of asm.segments) p.poke(s.addr, s.bytes);
  p.poke(SENTINEL, [0x18, 0xfe]); // JR $
  p.poke(SP0 - 2, [SENTINEL & 0xff, SENTINEL >> 8]);
  p.setRegs({ sp: SP0 - 2, iy: 0x5c3a, pc: asm.entry });
  const total = () => p.x.zx_frame_count() * TSTATES_PER_FRAME + p.x.zx_tstate();
  const t0 = total();
  const max = opts.maxSteps ?? 20_000_000;
  let steps = 0;
  while (p.regs.get16("pc") !== SENTINEL) {
    if (++steps > max) throw new Error(`el programa no vuelve tras ${max} instrucciones (PC=${p.regs.get16("pc").toString(16)})`);
    p.x.zx_step();
  }
  const t = total() - t0;
  const ram = p.ram();
  const sym = (n: string) => {
    const v = asm.symbols.get(n.startsWith("_") ? n : "_" + n);
    if (v === undefined) throw new Error(`símbolo ${n} no existe`);
    return v;
  };
  const u8 = (n: string, i = 0) => ram[(sym(n) + i) & 0xffff]!;
  const u16 = (n: string, i = 0) => ram[(sym(n) + 2 * i) & 0xffff]! | (ram[(sym(n) + 2 * i + 1) & 0xffff]! << 8);
  return {
    cc, asm, ret: p.regs.get16("bc"), t, steps, ram, sym, u8, u16,
    s8: (n, i = 0) => ((u8(n, i) ^ 0x80) - 0x80),
    s16: (n, i = 0) => ((u16(n, i) ^ 0x8000) - 0x8000),
    bytes: asm.segments.reduce((s, x) => s + x.bytes.length, 0),
    probe: p,
  };
}
