// Compilador de C a Z80 (K1). Puro (sin DOM), determinista. Genera fuente para el
// ensamblador A1. ABI: docs/c-abi.md. Uso y cLineMap: README.md.

import { ASM_BEGIN, ASM_END, CodeGen, MARK } from "./codegen";
import { asmRefs, constAddr, parseFile, Program } from "./parser";
import { peephole } from "./peephole";
import { Preprocessor, type Diag } from "./preproc";
import { crt0, helperCode } from "./runtime";
import { sizeOf, type FuncInfo, type Init, type Stmt, type VarSym } from "./types";
import type { Token } from "./lexer";

export interface CcError { file: string; line: number; col: number; msg: string; severity: "error" | "warning" }
export interface CLine { file: string; line: number; asmLine: number }

export interface CcOptions {
  /** Nombre (clave de `files`) del fichero con main. */
  main: string;
  /** Dirección de carga. Por defecto 0x8000. */
  org?: number;
  /** Resuelve #include y #pragma link que no están en `files` (librería). */
  includeResolver?: (name: string, from: string) => string | undefined;
  /** Desactiva el peephole (para medirlo). */
  peephole?: boolean;
  /** Solo compila `main` y lo enlazado, no el resto de .c de `files`. */
  onlyMain?: boolean;
}

export interface CcResult {
  asm: string;
  errors: CcError[];
  cLineMap: CLine[];
  /** Funciones emitidas (las alcanzables desde main) y eliminadas. */
  emitted: string[];
  removed: string[];
}

export function compile(files: Map<string, string>, opts: CcOptions): CcResult {
  const diags: Diag[] = [];
  const res = opts.includeResolver;
  const fromFiles = (n: string) => (files.has(n) ? { name: n, text: files.get(n)! } : undefined);
  const fromRes = (n: string, from: string) => {
    const t = res?.(n, from);
    return t === undefined ? undefined : { name: n, text: t };
  };
  const resolve = (n: string, from: string, angle: boolean) =>
    angle ? (fromRes(n, from) ?? fromFiles(n)) : (fromFiles(n) ?? fromRes(n, from));

  const sources = new Map<string, string[]>();
  const prog = new Program();
  const queue: { name: string; text: string }[] = [];
  const seen = new Set<string>();
  const mainText = files.get(opts.main);
  if (mainText === undefined) {
    return { asm: "", errors: [{ file: opts.main, line: 1, col: 1, msg: `no existe el fichero '${opts.main}'`, severity: "error" }], cLineMap: [], emitted: [], removed: [] };
  }
  queue.push({ name: opts.main, text: mainText });
  seen.add(opts.main);
  if (!opts.onlyMain) for (const [n, t] of files) if (/\.c$/i.test(n) && !seen.has(n)) { queue.push({ name: n, text: t }); seen.add(n); }
  const linkedAsm: { name: string; text: string }[] = [];
  let pragmaOrg: number | undefined;

  const resolveTracked = (n: string, from: string, angle: boolean) => {
    const r = resolve(n, from, angle);
    if (r && !sources.has(r.name)) sources.set(r.name, r.text.split("\n"));
    return r;
  };

  for (let fi = 0; fi < queue.length; fi++) {
    const u = queue[fi]!;
    sources.set(u.name, u.text.split("\n"));
    const pp = new Preprocessor(resolveTracked, diags);
    const toks: Token[] = pp.run(u.name, u.text);
    const last = toks[toks.length - 1];
    toks.push({ k: "eof", v: "", file: u.name, line: (last?.line ?? 1) + 1, col: 1, bol: true });
    parseFile(toks, fi, prog, diags);
    pragmaOrg ??= pp.org;
    for (const l of pp.links) {
      if (seen.has(l.name)) continue;
      seen.add(l.name);
      const r = resolveTracked(l.name, l.from.file, true);
      if (!r) { diags.push({ file: l.from.file, line: l.from.line, col: l.from.col, msg: `#pragma link: no se encuentra '${l.name}'`, severity: "error" }); continue; }
      if (/\.c$/i.test(l.name)) queue.push(r);
      else linkedAsm.push(r);
    }
  }

  // ---- enlace -------------------------------------------------------------------
  assignLabels(prog);
  const allAsm = [...prog.asmBlocks.map((b) => b.text), ...linkedAsm.map((a) => a.text)].join("\n");
  for (const b of prog.asmBlocks) for (const r of asmRefs(b.text, prog)) b.refs.add(r);
  for (const f of prog.funcs) if (f.body) walkAsm(f.body, (t) => { for (const r of asmRefs(t, prog)) f.refs.add(r); });

  const mainF = prog.funcs.find((f) => f.name === "main" && !f.isStatic);
  if (!mainF?.defined) diags.push({ file: opts.main, line: 1, col: 1, msg: "falta la función main", severity: "error" });

  // Alcanzables desde main y desde el ensamblador a nivel de fichero / enlazado.
  const live = new Set<VarSym | FuncInfo>();
  const work: (VarSym | FuncInfo)[] = [];
  const mark = (s: VarSym | FuncInfo) => { if (!live.has(s)) { live.add(s); work.push(s); } };
  if (mainF) mark(mainF);
  for (const b of prog.asmBlocks) for (const r of b.refs) mark(r);
  for (const a of linkedAsm) for (const r of asmRefs(a.text, prog)) mark(r);
  while (work.length) {
    const s = work.pop()!;
    for (const r of s.refs ?? []) mark(r);
  }

  // Externas sin definición en C: deben estar en el ensamblador.
  const crtLabels = new Set(["_exit"]);
  const definedInAsm = (label: string) => crtLabels.has(label) || new RegExp(`(^|\\n)[ \\t]*${label.replace(/[.$?@]/g, "\\$&")}(?![\\w.])`).test(allAsm);
  for (const s of live) {
    if ("naked" in s) {
      if (!s.defined && !definedInAsm(s.label)) diags.push({ ...s.pos, msg: `función '${s.name}' declarada y usada pero no definida (ni en C ni en ensamblador)`, severity: "error" });
    } else if (s.extern && !definedInAsm(s.label)) {
      diags.push({ ...s.pos, msg: `variable '${s.name}' declarada extern y usada pero no definida`, severity: "error" });
    }
  }

  const errors = finishDiags(diags);
  if (errors.some((e) => e.severity === "error")) return { asm: "", errors, cLineMap: [], emitted: [], removed: [] };

  // ---- código --------------------------------------------------------------------
  const srcLine = (file: string, line: number) => sources.get(file)?.[line - 1] ?? "";
  const gen = new CodeGen(prog, diags, srcLine);
  const emitted: string[] = [], removed: string[] = [];
  const funcs = prog.funcs.filter((f) => f.defined);
  const order = [...funcs.filter((f) => f === mainF), ...funcs.filter((f) => f !== mainF)];
  for (const f of order) {
    if (!live.has(f)) { removed.push(f.name); continue; }
    const start = gen.out.length;
    gen.genFunc(f);
    emitted.push(f.name);
    if (opts.peephole !== false) {
      const part = gen.out.splice(start);
      peephole(part);
      gen.out.push(...part);
    }
  }
  for (const b of prog.asmBlocks) { gen.out.push("", `; __asm de ${b.file}:${b.line}`); gen.asmText(b.text, b.file, b.line); }

  // Datos: rodata (const), data, bss.
  const rodata: string[] = [], data: string[] = [], bss: string[] = [];
  let bssSize = 0;
  for (const v of prog.globals) {
    if (!live.has(v) || v.extern) continue;
    if (v.init) {
      const dst = v.isConst ? rodata : data;
      dst.push(`${v.label}:`);
      dst.push(...emitInit(v.init, sizeOf(v.type), gen));
    } else {
      const sz = Math.max(1, sizeOf(v.type));
      bss.push(`${v.label} equ __bss_start+${bssSize}`);
      bssSize += sz;
    }
  }
  for (const b of gen.blobs) { rodata.push(`${b.label}:`); rodata.push(...emitInit(b.init, b.size, gen)); }
  // Las cadenas al final: emitInit puede haber añadido nuevas.
  const strs: string[] = [];
  for (const s of gen.stringOrder) strs.push(`${s.label}:`, ...dbLines([...s.bytes, 0]));

  const org = opts.org ?? pragmaOrg ?? 0x8000;
  const out: string[] = [
    `; Generado por el compilador de C de zxemuIAtor (K1). ABI: docs/c-abi.md`,
    `        org ${org}`,
    crt0(bssSize),
    ...gen.out,
  ];
  if (linkedAsm.length) for (const a of linkedAsm) out.push("", `; #pragma link "${a.name}"`, ASM_BEGIN, a.text, ASM_END);
  const hc = helperCode(gen.helpers);
  if (hc) out.push("", "; runtime", hc);
  if (rodata.length || strs.length) out.push("", "; rodata", ...rodata, ...strs);
  if (data.length) out.push("", "; data", ...data);
  out.push("", "; bss (no ocupa bytes: crt0 la pone a cero)", "__bss_start:", ...bss, `__bss_end equ __bss_start+${bssSize}`, "        end __start");

  // Texto final y cLineMap.
  const lines = out.join("\n").split("\n").filter((l) => l !== ASM_BEGIN && l !== ASM_END);
  const cLineMap: CLine[] = [];
  const final: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith(MARK)) {
      // Una marca sin código detrás (otra marca a continuación) no se mapea.
      let j = i + 1;
      while (j < lines.length && (lines[j]!.trim() === "" || /^\s*;/.test(lines[j]!) && !lines[j]!.startsWith(MARK))) j++;
      if (j < lines.length && lines[j]!.startsWith(MARK)) continue;
      const m = /^;#(.*):(\d+): /.exec(l)!;
      final.push("; " + l.slice(2));
      cLineMap.push({ file: m[1]!, line: Number(m[2]), asmLine: final.length });
      continue;
    }
    final.push(l);
  }
  return { asm: final.join("\n") + "\n", errors: finishDiags(diags), cLineMap, emitted, removed };
}

function walkAsm(s: Stmt, f: (text: string) => void) {
  switch (s.k) {
    case "asm": f(s.text); return;
    case "block": for (const b of s.body) walkAsm(b, f); return;
    case "if": walkAsm(s.a, f); if (s.b) walkAsm(s.b, f); return;
    case "while": case "do": case "switch": walkAsm(s.body, f); return;
    case "for": if (s.init) walkAsm(s.init, f); walkAsm(s.body, f); return;
  }
}

/** Labels de los static de fichero: `_x` salvo choque con otro fichero (docs/c-abi.md §2). */
function assignLabels(prog: Program) {
  const byName = new Map<string, (VarSym | FuncInfo)[]>();
  const fileScope: (VarSym | FuncInfo)[] = [...prog.funcs, ...prog.globals.filter((g) => !g.inFunc)];
  for (const s of fileScope) {
    const l = byName.get(s.name) ?? [];
    l.push(s);
    byName.set(s.name, l);
  }
  for (const [name, l] of byName) {
    if (l.length < 2) continue;
    for (const s of l) if (s.isStatic) s.label = `__s${s.fileIdx}_${name}`;
  }
}

function finishDiags(d: Diag[]): CcError[] {
  const seen = new Set<string>();
  const out: CcError[] = [];
  for (const e of d) {
    const k = `${e.file}:${e.line}:${e.col}:${e.msg}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ file: e.file, line: e.line, col: e.col, msg: e.msg, severity: e.severity });
  }
  return out;
}

function dbLines(bytes: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    // Tramos imprimibles entre comillas para que el ensamblador generado se lea.
    const parts: string[] = [];
    let str = "";
    for (const b of chunk) {
      if (b >= 32 && b < 127 && b !== 34 && b !== 92) { str += String.fromCharCode(b); continue; }
      if (str) { parts.push(`"${str}"`); str = ""; }
      parts.push(String(b));
    }
    if (str) parts.push(`"${str}"`);
    out.push("        db " + parts.join(","));
  }
  return out;
}

/** Imagen de un inicializador constante: db/dw con reubicaciones. */
function emitInit(init: Init, size: number, gen: CodeGen): string[] {
  const bytes = new Array<number>(size).fill(0);
  const reloc = new Map<number, string>();
  for (const it of init.items) {
    const c = constAddr(it.e)!;
    const sz = sizeOf(it.type);
    if (c.sym || c.str) {
      const label = c.sym ? c.sym.label : gen.strLabel(c.str!);
      reloc.set(it.off, c.off === 0 ? label : `${label}${c.off > 0 ? "+" : "-"}${Math.abs(c.off)}`);
      continue;
    }
    bytes[it.off] = c.off & 0xff;
    if (sz === 2) bytes[it.off + 1] = (c.off >> 8) & 0xff;
  }
  const out: string[] = [];
  let run: number[] = [];
  const flush = () => { if (run.length) { out.push(...dbLines(run)); run = []; } };
  for (let o = 0; o < size; o++) {
    const r = reloc.get(o);
    if (r !== undefined) { flush(); out.push(`        dw ${r}`); o++; continue; }
    run.push(bytes[o]!);
  }
  flush();
  return out;
}

export { MARK };
