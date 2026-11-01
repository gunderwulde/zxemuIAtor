// Arnés de L1 para programas C: compila con K1 (web/src/cc) y la librería, y ejecuta
// como la UI (I1: inyectar en el editor de BASIC, interrupciones en IM 1 activas).
import { compile, type CcResult } from "../../web/src/cc";
import { clibResolve } from "../../web/src/clib";
import { assembleAndRun, atSafePoint } from "../../web/src/ui/run";
import { screenLines } from "../util/screen";
import type { Probe } from "../util/probe";
import { booted, hold } from "./harness";

export function compileC(src: string): CcResult {
  return compile(new Map([["main.c", src]]), { main: "main.c", includeResolver: (n) => clibResolve(n) });
}

export interface CRun {
  p: Probe;
  cc: CcResult;
  bytes: number;
  sym(name: string): number;
  frames(n: number): void;
  text(): string[];
  attr(col: number, row: number): number;
  press(keys: string[], n: number, after?: number): void;
  /** El programa ha vuelto a BASIC (el editor espera una tecla). */
  back(): boolean;
}

export async function runC(src: string): Promise<CRun> {
  const cc = compileC(src);
  const errs = cc.errors;
  if (errs.length) throw new Error("compilación:\n" + errs.map((e) => `${e.file}:${e.line}:${e.col}: ${e.severity}: ${e.msg}`).join("\n"));
  const p = await booted();
  const rep = assembleAndRun(p, cc.asm);
  if (!rep.ok || rep.asm.errors.length) throw new Error("ensamblado:\n" + JSON.stringify(rep.messages));
  const r: CRun = {
    p, cc,
    bytes: rep.asm.segments.reduce((n, s) => n + s.bytes.length, 0),
    sym(name) {
      const v = rep.asm.symbols.get(name);
      if (v === undefined) throw new Error(`símbolo ${name}`);
      return v;
    },
    frames(n) { for (let i = 0; i < n; i++) p.runFrame(); },
    text: () => screenLines(p.ram()),
    attr: (col, row) => p.ram()[0x5800 + 32 * row + col]!,
    press(keys, n, after = 0) {
      hold(p, keys, true);
      r.frames(n);
      hold(p, keys, false);
      r.frames(after);
    },
    back() {
      // En BASIC el PC está en la ROM y la vuelta de WAIT-KEY1 dura ~100 T.
      for (let i = 0; i < 2000 && !atSafePoint(p); i++) p.x.zx_step();
      return atSafePoint(p);
    },
  };
  return r;
}
