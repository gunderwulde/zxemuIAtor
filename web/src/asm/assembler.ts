// Ensamblador Z80 de dos pasadas. Puro (sin DOM) y determinista.
//
// Pasada 1: recorre el fuente, expande macros, decide los IF y calcula direcciones y
// tamaños. Pasada 2: repite exactamente el mismo recorrido y emite bytes. Los valores que
// deciden el recorrido o los tamaños (IF, IFDEF, ORG, DS, ALIGN, REPT) se calculan en la
// pasada 1 y se reutilizan tal cual en la 2 (caché p1), así las dos pasadas no pueden
// divergir. Por eso esos valores deben poder calcularse sin referencias hacia delante.

import { Z80_ISA, OP_D, OP_E, OP_N, OP_NN, type IsaEntry } from "../z80isa/index";
import { evaluate, isIdentChar, isIdentStart, parseNumberToken, parseString, type ExprEnv, type ExprResult } from "./expr";

export interface AsmOptions {
  /** Dirección inicial si el fuente no tiene ORG. Por defecto 0x8000. */
  org?: number;
  /** Resuelve INCLUDE: devuelve el texto o undefined si no existe. */
  include?: (path: string, from: string | undefined) => string | undefined;
  /** Resuelve INCBIN: devuelve los bytes o undefined si no existe. */
  incbin?: (path: string, from: string | undefined) => Uint8Array | undefined;
  /** Símbolos predefinidos (como EQU). */
  defines?: Record<string, number>;
  /** Máximo de errores + avisos devueltos. Por defecto 500. */
  maxErrors?: number;
}

export interface AsmSegment {
  addr: number;
  bytes: Uint8Array;
}

export interface AsmLineInfo {
  addr: number;
  /** Línea (1-based) del fichero; en expansiones de macro, la línea de la llamada. */
  line: number;
  len: number;
  /** Fichero incluido con INCLUDE; undefined = fuente principal. */
  file?: string;
}

export interface AsmError {
  line: number;
  /** Columna 1-based. */
  col: number;
  msg: string;
  severity: "error" | "warning";
  file?: string;
}

export interface AsmResult {
  segments: AsmSegment[];
  entry: number;
  symbols: Map<string, number>;
  lineMap: AsmLineInfo[];
  errors: AsmError[];
}

// ---------------------------------------------------------------------------
// Índice de la tabla ISA por "forma" de operandos.

const ALU8 = new Set(["add", "adc", "sub", "sbc", "and", "xor", "or", "cp"]);

function isaOperandKey(op: string): string {
  switch (op) {
    case "n": case "nn": case "rel": return "*";
    case "(n)": case "(nn)": return "(*)";
    case "(ix+d)": return "(ix+*)";
    case "(iy+d)": return "(iy+*)";
  }
  const c = op.charCodeAt(0);
  if (c >= 48 && c <= 57) return String(parseNumberToken(op));
  return op;
}

function buildKey(mn: string, ops: string[]): string {
  // "add a,b" y "add b" son la misma instrucción; también "sub a,b" y "sub b".
  if (ALU8.has(mn) && ops.length === 2 && ops[0] === "a") ops = ops.slice(1);
  return ops.length ? mn + " " + ops.join(",") : mn;
}

const ISA_BY_KEY = new Map<string, IsaEntry>();
const MNEMONICS = new Set<string>();
for (const e of Z80_ISA) {
  MNEMONICS.add(e.mnemonic);
  if (e.dup) continue;
  const key = buildKey(e.mnemonic, e.operands.map(isaOperandKey));
  if (ISA_BY_KEY.has(key)) throw new Error(`z80isa: clave duplicada ${key}`);
  ISA_BY_KEY.set(key, e);
}
const MN_ALIAS: Record<string, string> = { sl1: "sll", sli: "sll" };
MNEMONICS.add("sl1");
MNEMONICS.add("sli");
MNEMONICS.add("exa");

const REGS: Record<string, string> = {
  a: "a", b: "b", c: "c", d: "d", e: "e", h: "h", l: "l", i: "i", r: "r",
  af: "af", "af'": "af'", bc: "bc", de: "de", hl: "hl", sp: "sp", ix: "ix", iy: "iy",
  ixh: "ixh", ixl: "ixl", iyh: "iyh", iyl: "iyl",
  xh: "ixh", xl: "ixl", yh: "iyh", yl: "iyl", hx: "ixh", lx: "ixl", hy: "iyh", ly: "iyl",
};
const CONDS = new Set(["nz", "z", "nc", "c", "po", "pe", "p", "m"]);
const COND_MN = new Set(["jp", "jr", "call", "ret"]);
const LD_ROT = /^(rlc|rrc|rl|rr|sla|sra|sll|sl1|sli|srl|res|set)\s/i;

const DIRECTIVES = new Set([
  "org", "equ", "defl", "db", "defb", "byte", "defm", "dm", "dz", "dc", "dw", "defw", "word",
  "ds", "defs", "block", "align", "end", "ent", "macro", "endm", "endmacro", "local",
  "if", "ifdef", "ifndef", "ifidn", "ifdif", "else", "elseif", "endif", "include", "incbin", "error",
  "rept", "dup", "repeat", "endr", "edup", "endrepeat", "aseg", "title", "subttl", "eject", "page", "device", "z80",
]);
const IGNORED = new Set(["aseg", "title", "subttl", "eject", "page", "device", "z80"]);
const CONDITIONALS = new Set(["if", "ifdef", "ifndef", "ifidn", "ifdif", "else", "elseif", "endif"]);
const KNOWN_OPS = new Map<string, string>();
for (const w of [...DIRECTIVES, ...MNEMONICS, "=", ":="]) KNOWN_OPS.set(w, w);

// ---------------------------------------------------------------------------
// Utilidades de texto.

/** ¿La comilla en text[i] es la de "af'" y no el inicio de una cadena? */
function isAfQuote(text: string, i: number): boolean {
  if (i < 2) return false;
  const a = text.charCodeAt(i - 2) | 0x20, f = text.charCodeAt(i - 1) | 0x20;
  if (a !== 97 || f !== 102) return false;
  return i < 3 || !isIdentChar(text.charCodeAt(i - 3));
}

/** Índice tras la cadena que empieza en text[i] (o text.length si no se cierra). */
function skipString(text: string, i: number): number {
  const q = text.charCodeAt(i);
  let j = i + 1;
  while (j < text.length) {
    const c = text.charCodeAt(j);
    if (c === 92 && q === 34) { j += 2; continue; }
    if (c === q) {
      if (q === 39 && text.charCodeAt(j + 1) === 39) { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
  return text.length;
}

/** Posición del ';' que inicia el comentario, o text.length. */
function commentStart(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 59) return i;
    if (c === 39 || c === 34) {
      if (c === 39 && isAfQuote(text, i)) continue;
      i = skipString(text, i) - 1;
    }
  }
  return text.length;
}

function isWs(c: number): boolean {
  return c === 32 || c === 9;
}

/** Divide text[s,e) por comas de nivel 0; devuelve pares [inicio, fin) ya recortados. */
function splitArgs(text: string, s: number, e: number): number[] {
  const out: number[] = [];
  let depth = 0, start = s;
  for (let i = s; i <= e; i++) {
    const c = i < e ? text.charCodeAt(i) : 44;
    if (i < e && (c === 39 || c === 34)) {
      if (c === 39 && isAfQuote(text, i)) continue;
      i = Math.min(skipString(text, i), e) - 1;
      continue;
    }
    if (c === 40) depth++;
    else if (c === 41) depth--;
    else if (c === 44 && (depth <= 0 || i === e)) {
      let a = start, b = i;
      while (a < b && isWs(text.charCodeAt(a))) a++;
      while (b > a && isWs(text.charCodeAt(b - 1))) b--;
      out.push(a, b);
      start = i + 1;
    }
  }
  return out;
}

/** Índice del ')' que cierra el '(' de text[s], o -1. */
function matchParen(text: string, s: number, e: number): number {
  let depth = 0;
  for (let i = s; i < e; i++) {
    const c = text.charCodeAt(i);
    if (c === 39 || c === 34) { i = skipString(text, i) - 1; continue; }
    if (c === 40) depth++;
    else if (c === 41 && --depth === 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------

interface MacroDef {
  name: string;
  params: string[];
  defaults: string[];
  locals: string[];
  body: string[];
}

interface IfState {
  taking: boolean;
  taken: boolean;
  outer: boolean;
}

interface Collect {
  kind: "macro" | "rept";
  def: MacroDef;
  count: number;
  depth: number;
  /** Línea y posición de la directiva que abrió la recogida. */
  line: number;
  col: number;
  discard: boolean;
}

interface Operand {
  key: string;
  /** Rango de la expresión (inmediato, dirección o desplazamiento); s<0 si no hay. */
  s: number;
  e: number;
  index: boolean;
}

interface PendingEqu {
  name: string;
  text: string;
  scope: string;
  macroPrefix: string | null;
  pc: number;
}

class Assembler {
  readonly opts: AsmOptions;
  pass = 1;
  pc = 0;
  stmtPc = 0;
  global = "";
  macroPrefix: string | null = null;
  macroName = "";
  macroDepth = 0;
  includeDepth = 0;
  siteLine = 0;
  siteCol = 1;
  siteFile: string | undefined;
  ended = false;
  ifStack: IfState[] = [];
  macros = new Map<string, MacroDef>();
  collect: Collect | null = null;
  expansion = 0;

  symbols = new Map<string, number>();
  redefinable = new Set<string>();
  definedThisPass = new Set<string>();
  pending: PendingEqu[] = [];
  p1: number[] = [];
  p1idx = 0;
  recs: LineRec[] = [];
  recIdx = 0;
  rec!: LineRec;

  entry: number | undefined;
  firstAddr: number | undefined;
  mem = new Uint8Array(65536);
  written = new Uint8Array(65536);
  stmtOverlap = false;
  stmtOverflow = false;
  lineMap: AsmLineInfo[] = [];
  errors: AsmError[] = [];
  p1Errors: AsmError[] = [];
  maxErrors: number;
  env: ExprEnv;

  constructor(opts: AsmOptions) {
    this.opts = opts;
    this.maxErrors = opts.maxErrors ?? 500;
    const self = this;
    this.env = {
      get pc() { return self.stmtPc; },
      lookup: (name: string) => self.lookup(name),
    };
  }

  // ---- errores ----

  report(pos: number, msg: string, severity: "error" | "warning" = "error", p1only = false): void {
    let col = pos + 1;
    if (this.macroDepth > 0) {
      col = this.siteCol;
      msg = `en macro '${this.macroName}': ${msg}`;
    }
    const err: AsmError = { line: this.siteLine, col, msg, severity };
    if (this.siteFile !== undefined) err.file = this.siteFile;
    if (this.pass === 1) {
      if (p1only) this.p1Errors.push(err);
    } else {
      this.errors.push(err);
    }
  }

  /** Evalúa y, si hay error de sintaxis, lo informa. */
  ev(text: string, s: number, e: number): ExprResult {
    const r = evaluate(text, s, e, this.env);
    if (r.error !== undefined) this.report(r.errorPos!, r.error);
    return r;
  }

  /** Valor que debe conocerse en la pasada 2; informa si es indefinido. undefined si falla. */
  value(text: string, s: number, e: number): number | undefined {
    if (s >= e) { this.report(s, "falta una expresión"); return undefined; }
    const r = this.ev(text, s, e);
    if (r.error !== undefined) return undefined;
    if (!r.resolved) {
      if (this.pass === 2) this.report(r.undefPos!, `símbolo no definido '${r.undefName}'`);
      return undefined;
    }
    return r.value;
  }

  /** Valor que decide tamaño o recorrido: se calcula en la pasada 1 y se reutiliza. */
  p1Value(text: string, s: number, e: number): number {
    if (this.pass === 2) return this.p1[this.p1idx++] ?? 0;
    let v = 0;
    if (s >= e) this.report(s, "falta una expresión", "error", true);
    else {
      const r = evaluate(text, s, e, this.env);
      if (r.error !== undefined) this.report(r.errorPos!, r.error, "error", true);
      else if (!r.resolved) this.report(r.undefPos!, `'${r.undefName}' debe estar definido antes de usarse aquí`, "error", true);
      else v = r.value;
    }
    this.p1.push(v);
    return v;
  }

  p1Flag(v: boolean): boolean {
    if (this.pass === 2) return (this.p1[this.p1idx++] ?? 0) !== 0;
    this.p1.push(v ? 1 : 0);
    return v;
  }

  // ---- símbolos ----

  /**
   * Dentro de una macro, ".x" se busca primero entre las etiquetas de la expansión y,
   * si no existe, en la global actual (como sjasm): así una macro puede recibir ".x"
   * del llamador como argumento.
   */
  lookup(name: string): number | undefined {
    const v = this.symbols.get(this.qualify(name));
    if (v !== undefined || this.macroPrefix === null || name.charCodeAt(0) !== 46) return v;
    return this.symbols.get(this.global + name);
  }

  qualify(name: string): string {
    if (name.charCodeAt(0) !== 46) return name;
    if (name.charCodeAt(1) === 64) return this.global + "." + name.slice(2); // .@x
    if (this.macroPrefix !== null) return this.macroPrefix + name;
    return this.global + name;
  }

  defineLabel(name: string, pos: number): void {
    const full = this.qualify(name);
    if (name.charCodeAt(0) !== 46 && !name.includes("??")) this.global = name;
    if (this.redefinable.has(full)) {
      this.report(pos, `'${full}' ya está definido con '=' o ':='`);
      return;
    }
    if (this.definedThisPass.has(full)) {
      this.report(pos, `símbolo duplicado '${full}'`);
      return;
    }
    this.definedThisPass.add(full);
    if (this.pass === 2 && this.symbols.get(full) !== this.pc) {
      this.report(pos, `error de fase en '${full}' (interno)`);
    }
    this.symbols.set(full, this.pc);
  }

  defineEqu(name: string, pos: number, text: string, s: number, e: number): void {
    const full = this.qualify(name);
    if (this.definedThisPass.has(full) || this.redefinable.has(full)) {
      this.report(pos, `símbolo duplicado '${full}'`);
      return;
    }
    this.definedThisPass.add(full);
    if (s >= e) { this.report(s, "falta una expresión"); return; }
    const r = this.ev(text, s, e);
    if (r.error !== undefined) return;
    if (r.resolved) { this.symbols.set(full, r.value); return; }
    if (this.pass === 1) {
      this.pending.push({ name: full, text: text.slice(s, e), scope: this.global, macroPrefix: this.macroPrefix, pc: this.pc });
    } else if (!this.symbols.has(full)) {
      this.report(r.undefPos!, `símbolo no definido '${r.undefName}'`);
    }
  }

  defineSet(name: string, pos: number, text: string, s: number, e: number): void {
    const full = this.qualify(name);
    if (this.definedThisPass.has(full) && !this.redefinable.has(full)) {
      this.report(pos, `'${full}' ya está definido y no es redefinible`);
      return;
    }
    this.definedThisPass.add(full);
    this.redefinable.add(full);
    const v = this.value(text, s, e);
    if (v !== undefined) this.symbols.set(full, v);
  }

  /** Tras la pasada 1: resuelve EQU que dependían de símbolos definidos más tarde. */
  resolvePending(): void {
    let progress = true;
    while (progress && this.pending.length) {
      progress = false;
      const rest: PendingEqu[] = [];
      for (const p of this.pending) {
        this.global = p.scope;
        this.macroPrefix = p.macroPrefix;
        this.stmtPc = p.pc;
        const r = evaluate(p.text, 0, p.text.length, this.env);
        if (r.resolved && r.error === undefined) { this.symbols.set(p.name, r.value); progress = true; }
        else rest.push(p);
      }
      this.pending = rest;
    }
  }

  // ---- emisión ----

  emit(b: number): void {
    if (this.pc > 0xffff) {
      if (!this.stmtOverflow) { this.stmtOverflow = true; this.report(0, "el código sobrepasa la dirección FFFFh"); }
      this.pc++;
      return;
    }
    if (this.firstAddr === undefined) this.firstAddr = this.pc;
    if (this.pass === 2) {
      if (this.written[this.pc] && !this.stmtOverlap) {
        this.stmtOverlap = true;
        this.report(0, `se sobrescribe la dirección ${this.pc.toString(16).toUpperCase().padStart(4, "0")}h`, "warning");
      }
      this.mem[this.pc] = b & 0xff;
      this.written[this.pc] = 1;
    }
    this.pc++;
  }

  emitByteValue(v: number | undefined, pos: number): void {
    if (v !== undefined && (v < -128 || v > 255)) this.report(pos, `valor ${v} fuera de rango de byte (se trunca)`, "warning");
    this.emit(v ?? 0);
  }

  emitWordValue(v: number | undefined, pos: number): void {
    if (v !== undefined && (v < -32768 || v > 65535)) this.report(pos, `valor ${v} fuera de rango de palabra (se trunca)`, "warning");
    const w = v ?? 0;
    this.emit(w);
    this.emit(w >> 8);
  }

  // ---- recorrido ----

  runLines(lines: string[], file: string | undefined): void {
    const saveFile = this.siteFile;
    for (let i = 0; i < lines.length && !this.ended; i++) {
      this.siteFile = file;
      this.siteLine = i + 1;
      this.processLine(lines[i]!);
    }
    this.siteFile = saveFile;
  }

  get active(): boolean {
    const n = this.ifStack.length;
    return n === 0 || this.ifStack[n - 1]!.taking;
  }

  processLine(raw: string): void {
    // La pasada 2 recorre exactamente las mismas líneas que la 1: reutiliza el análisis.
    let rec: LineRec;
    if (this.pass === 1) { rec = parseLine(raw); this.recs.push(rec); }
    else rec = this.recs[this.recIdx++]!;
    this.rec = rec;
    const text = rec.text, label = rec.label, labelPos = rec.labelPos, op = rec.op, lop = rec.lop;
    const opPos = rec.opPos, argS = rec.argS, argE = rec.argE;

    // Recogida del cuerpo de MACRO / REPT.
    const col = this.collect;
    if (col !== null) {
      if (col.kind === "macro") {
        if (lop === "endm" || lop === "endmacro") { this.finishCollect(); return; }
        if (lop === "macro") { this.report(opPos, "no se admiten definiciones de macro anidadas"); return; }
      } else {
        if (lop === "rept" || lop === "dup" || lop === "repeat") col.depth++;
        else if ((lop === "endr" || lop === "edup" || lop === "endrepeat") && --col.depth === 0) { this.finishCollect(); return; }
      }
      if (lop === "local" && col.kind === "macro") {
        const parts = splitArgs(text, argS, argE);
        for (let k = 0; k < parts.length; k += 2) col.def.locals.push(text.slice(parts[k], parts[k + 1]));
        return;
      }
      col.def.body.push(raw);
      return;
    }

    this.stmtPc = this.pc;
    if (CONDITIONALS.has(lop)) { this.conditional(lop, text, argS, argE, opPos); return; }
    if (!this.active) {
      // Una macro dentro de un IF falso se salta entera sin interpretar su cuerpo.
      if (lop === "macro") this.collect = { kind: "macro", def: { name: "", params: [], defaults: [], locals: [], body: [] }, count: 0, depth: 1, discard: true, line: 0, col: 0 };
      else if (lop === "rept" || lop === "dup" || lop === "repeat") this.collect = { kind: "rept", def: { name: "", params: [], defaults: [], locals: [], body: [] }, count: 0, depth: 1, discard: true, line: 0, col: 0 };
      return;
    }

    this.stmtOverlap = false;
    this.stmtOverflow = false;

    // Definiciones que consumen la etiqueta.
    switch (lop) {
      case "equ":
        if (label === null) { this.report(opPos, "EQU necesita una etiqueta"); return; }
        this.defineEqu(label, labelPos, text, argS, argE);
        return;
      case "=": case ":=": case "defl":
        if (label === null) { this.report(opPos, `'${op}' necesita una etiqueta`); return; }
        this.defineSet(label, labelPos, text, argS, argE);
        return;
      case "macro":
        this.beginMacro(label, text, argS, argE, opPos);
        return;
    }
    if (label !== null) this.defineLabel(label, labelPos);
    if (op === "") return;

    const startPc = this.pc;
    const mapLen = this.lineMap.length;
    this.statement(op, lop, text, argS, argE, opPos);
    // Si la sentencia era una macro o un INCLUDE, ya se registraron sus líneas internas.
    if (this.pass === 2 && this.pc > startPc && startPc <= 0xffff && this.lineMap.length === mapLen) {
      const info: AsmLineInfo = { addr: startPc, line: this.siteLine, len: this.pc - startPc };
      if (this.siteFile !== undefined) info.file = this.siteFile;
      this.lineMap.push(info);
    }
  }

  conditional(lop: string, text: string, s: number, e: number, opPos: number): void {
    const st = this.ifStack;
    const outer = this.active;
    switch (lop) {
      case "if": {
        const cond = outer ? this.p1Value(text, s, e) !== 0 : false;
        st.push({ taking: outer && cond, taken: cond, outer });
        return;
      }
      case "ifdef": case "ifndef": {
        let cond = false;
        if (outer) {
          const name = text.slice(s, e);
          const def = this.symbols.has(this.qualify(name)) && (this.pass === 1 ? this.definedThisPass.has(this.qualify(name)) : true);
          cond = this.p1Flag(lop === "ifdef" ? def : !def);
        }
        st.push({ taking: outer && cond, taken: cond, outer });
        return;
      }
      case "ifidn": case "ifdif": {
        let cond = false;
        if (outer) {
          const parts = splitArgs(text, s, e);
          if (parts.length !== 4) this.report(opPos, `${lop.toUpperCase()} necesita dos argumentos`);
          else {
            const a = stripAngle(text.slice(parts[0], parts[1]));
            const b = stripAngle(text.slice(parts[2], parts[3]));
            cond = (a === b) === (lop === "ifidn");
          }
        }
        st.push({ taking: outer && cond, taken: cond, outer });
        return;
      }
    }
    const top = st[st.length - 1];
    if (top === undefined) { this.report(opPos, `${lop.toUpperCase()} sin IF`); return; }
    switch (lop) {
      case "elseif":
        if (top.taken || !top.outer) top.taking = false;
        else {
          const cond = this.p1Value(text, s, e) !== 0;
          top.taking = cond;
          top.taken = cond;
        }
        return;
      case "else":
        top.taking = top.outer && !top.taken;
        top.taken = true;
        return;
      case "endif":
        st.pop();
        return;
    }
  }

  beginMacro(label: string | null, text: string, s: number, e: number, opPos: number): void {
    let name: string;
    let ps = s;
    if (label !== null) name = label;
    else {
      let j = s;
      while (j < e && isIdentChar(text.charCodeAt(j))) j++;
      name = text.slice(s, j);
      ps = j;
      while (ps < e && (isWs(text.charCodeAt(ps)) || text.charCodeAt(ps) === 44)) ps++;
    }
    const def: MacroDef = { name, params: [], defaults: [], locals: [], body: [] };
    if (name === "" || !isIdentStart(name.charCodeAt(0))) {
      this.report(opPos, "MACRO necesita un nombre");
      this.collect = { kind: "macro", def, count: 0, depth: 1, discard: true, line: 0, col: 0 };
      return;
    }
    const parts = splitArgs(text, ps, e);
    for (let k = 0; k < parts.length; k += 2) {
      const p = text.slice(parts[k], parts[k + 1]);
      if (p === "") continue;
      // sjasm: "nombre:valor" da un valor por defecto al parámetro.
      const colon = p.indexOf(":");
      def.params.push(colon < 0 ? p : p.slice(0, colon).trim());
      def.defaults.push(colon < 0 ? "" : p.slice(colon + 1).trim());
    }
    let discard = false;
    const key = name.toLowerCase();
    if (this.macros.has(key)) { this.report(opPos, `macro '${name}' redefinida`); discard = true; }
    this.collect = { kind: "macro", def, count: 0, depth: 1, discard, line: 0, col: 0 };
  }

  finishCollect(): void {
    const c = this.collect!;
    this.collect = null;
    if (c.discard) return;
    if (c.kind === "macro") { this.macros.set(c.def.name.toLowerCase(), c.def); return; }
    // Los errores del cuerpo se atribuyen a la línea del REPT (si no está dentro de una macro).
    const saveLine = this.siteLine;
    if (this.macroDepth === 0) this.siteLine = c.line;
    for (let k = 0; k < c.count && !this.ended; k++) this.expand(c.def, [], c.col, k);
    this.siteLine = saveLine;
  }

  expand(def: MacroDef, args: string[], pos: number, iter = -1): void {
    if (this.macroDepth >= 64) { this.report(pos, "demasiadas expansiones de macro anidadas"); return; }
    const id = ++this.expansion;
    const map = new Map<string, string>();
    for (let k = 0; k < def.params.length; k++) {
      const a = args[k];
      map.set(def.params[k]!.toLowerCase(), a !== undefined && a !== "" ? a : def.defaults[k] ?? "");
    }
    for (const l of def.locals) map.set(l.toLowerCase(), `${l}??${id}`);
    const savePrefix = this.macroPrefix, saveName = this.macroName, saveCol = this.siteCol;
    if (this.macroDepth === 0) this.siteCol = pos + 1;
    this.macroDepth++;
    this.macroPrefix = `${def.name || "rept"}@${id}`;
    this.macroName = def.name || "REPT";
    for (const line of def.body) {
      if (this.ended) break;
      let l = map.size ? substitute(line, map) : line;
      // sjasm: @# es el número de iteración dentro de REPEAT.
      if (iter >= 0 && l.includes("@#")) l = l.replaceAll("@#", String(iter));
      this.processLine(l);
    }
    this.macroDepth--;
    this.macroPrefix = savePrefix;
    this.macroName = saveName;
    this.siteCol = saveCol;
  }

  statement(op: string, lop: string, text: string, s: number, e: number, opPos: number): void {
    switch (lop) {
      case "org": {
        const v = this.p1Value(text, s, e);
        if (v < 0 || v > 0xffff) this.report(s, "ORG fuera de 0..FFFFh");
        this.pc = v & 0xffff;
        return;
      }
      case "db": case "defb": case "byte": case "defm": case "dm": case "dz": case "dc":
        this.dataBytes(lop, text, s, e);
        return;
      case "dw": case "defw": case "word":
        this.dataWords(text, s, e);
        return;
      case "ds": case "defs": case "block": {
        const parts = splitArgs(text, s, e);
        if (parts.length === 0 || parts[0] === parts[1]) { this.report(s, "DS necesita un tamaño"); return; }
        const n = this.p1Value(text, parts[0]!, parts[1]!);
        if (n < 0 || n > 0x10000) { this.report(parts[0]!, `tamaño de DS no válido (${n})`); return; }
        let fill = 0;
        if (parts.length >= 4) fill = (this.pass === 2 ? this.value(text, parts[2]!, parts[3]!) : 0) ?? 0;
        for (let k = 0; k < n; k++) this.emit(fill);
        return;
      }
      case "align": {
        const parts = splitArgs(text, s, e);
        const n = parts.length ? this.p1Value(text, parts[0]!, parts[1]!) : 0;
        if (n <= 0 || n > 0x10000) { this.report(s, "ALIGN necesita un valor entre 1 y 65536"); return; }
        let fill = 0;
        if (parts.length >= 4) fill = (this.pass === 2 ? this.value(text, parts[2]!, parts[3]!) : 0) ?? 0;
        const pad = (n - (this.pc % n)) % n;
        for (let k = 0; k < pad; k++) this.emit(fill);
        return;
      }
      case "end":
        if (s < e && this.pass === 2) {
          const v = this.value(text, s, e);
          if (v !== undefined) this.entry = v & 0xffff;
        }
        this.ended = true;
        return;
      case "ent":
        if (this.pass === 2) {
          const v = s < e ? this.value(text, s, e) : this.pc;
          if (v !== undefined) this.entry = v & 0xffff;
        }
        return;
      case "endm": case "endmacro":
        this.report(opPos, "ENDM sin MACRO");
        return;
      case "endr": case "edup": case "endrepeat":
        this.report(opPos, `${op.toUpperCase()} sin REPT`);
        return;
      case "local":
        this.report(opPos, "LOCAL sólo puede usarse dentro de una macro");
        return;
      case "rept": case "dup": case "repeat": {
        const n = this.p1Value(text, s, e);
        const def: MacroDef = { name: "", params: [], defaults: [], locals: [], body: [] };
        if (n < 0) this.report(s, "REPT con cuenta negativa");
        this.collect = { kind: "rept", def, count: Math.max(0, n), depth: 1, discard: false, line: this.siteLine, col: opPos };
        return;
      }
      case "include":
        this.include(text, s, e);
        return;
      case "incbin":
        this.incbin(text, s, e);
        return;
      case "error": {
        let msg = text.slice(s, e);
        const c = text.charCodeAt(s);
        if (c === 39 || c === 34) msg = String.fromCharCode(...parseString(text, s, e).bytes);
        this.report(opPos, msg || "ERROR");
        return;
      }
    }
    if (IGNORED.has(lop)) return;
    const mac = this.macros.get(lop);
    if (mac !== undefined) {
      this.expand(mac, macroArgs(text, s, e), opPos);
      return;
    }
    this.instruction(op, lop, text, s, e, opPos);
  }

  include(text: string, s: number, e: number): void {
    let path = text.slice(s, e);
    const c = text.charCodeAt(s);
    if (c === 39 || c === 34) path = String.fromCharCode(...parseString(text, s, e).bytes);
    else if (c === 60 && text.charCodeAt(e - 1) === 62) path = path.slice(1, -1);
    if (!this.opts.include) { this.report(s, "INCLUDE no disponible (no hay resolvedor de ficheros)"); return; }
    if (this.includeDepth >= 16) { this.report(s, "demasiados INCLUDE anidados"); return; }
    let src: string | undefined;
    try { src = this.opts.include(path, this.siteFile); } catch (err) { this.report(s, err instanceof Error ? err.message : String(err)); return; }
    if (src === undefined) { this.report(s, `no se encuentra el fichero '${path}'`); return; }
    const saveLine = this.siteLine;
    this.includeDepth++;
    this.runLines(splitLines(src), path);
    this.includeDepth--;
    this.siteLine = saveLine;
  }

  /** INCBIN "fichero"[, desplazamiento[, longitud]]: vuelca los bytes tal cual. */
  incbin(text: string, s: number, e: number): void {
    const parts = splitArgs(text, s, e);
    if (parts.length > 6) { this.report(s, "INCBIN admite como mucho 3 argumentos"); return; }
    const ps = parts[0]!, pe = parts[1]!;
    if (ps >= pe) { this.report(s, "falta el nombre del fichero"); return; }
    let path = text.slice(ps, pe);
    const c = text.charCodeAt(ps);
    if (c === 39 || c === 34) path = String.fromCharCode(...parseString(text, ps, pe).bytes);
    if (!this.opts.incbin) { this.report(s, "INCBIN no disponible (no hay resolvedor de ficheros)"); return; }
    let data: Uint8Array | undefined;
    try { data = this.opts.incbin(path, this.siteFile); } catch (err) { this.report(s, err instanceof Error ? err.message : String(err)); return; }
    if (data === undefined) { this.report(s, `no se encuentra el fichero '${path}'`); return; }
    const off = parts.length >= 4 ? this.p1Value(text, parts[2]!, parts[3]!) : 0;
    const len = parts.length >= 6 ? this.p1Value(text, parts[4]!, parts[5]!) : data.length - off;
    if (off < 0 || len < 0 || off + len > data.length) {
      this.report(s, `INCBIN fuera de rango: '${path}' tiene ${data.length} bytes (desplazamiento ${off}, longitud ${len})`);
      return;
    }
    for (let k = 0; k < len; k++) this.emit(data[off + k]!);
  }

  dataBytes(lop: string, text: string, s: number, e: number): void {
    const parts = splitArgs(text, s, e);
    if (parts.length === 0) { this.report(s, "faltan datos"); return; }
    let lastStr = -1;
    for (let k = 0; k < parts.length; k += 2) {
      const a = parts[k]!, b = parts[k + 1]!;
      if (a === b) { this.report(a, "dato vacío"); continue; }
      const c = text.charCodeAt(a);
      if (c === 39 || c === 34) {
        const lit = parseString(text, a, b);
        if (lit.end === b && lit.error === undefined) {
          for (const ch of lit.bytes) {
            if (ch > 255) this.report(a, `carácter fuera de rango (U+${ch.toString(16).toUpperCase()})`, "warning");
            this.emit(ch);
          }
          if (lit.bytes.length) lastStr = this.pc - 1;
          continue;
        }
        if (lit.error !== undefined) { this.report(a, lit.error); continue; }
      }
      if (this.pass === 1) { this.emit(0); continue; }
      this.emitByteValue(this.value(text, a, b), a);
    }
    if (lop === "dz") this.emit(0);
    else if (lop === "dc" && this.pass === 2 && lastStr >= 0 && lastStr <= 0xffff) this.mem[lastStr]! |= 0x80;
  }

  dataWords(text: string, s: number, e: number): void {
    const parts = splitArgs(text, s, e);
    if (parts.length === 0) { this.report(s, "faltan datos"); return; }
    for (let k = 0; k < parts.length; k += 2) {
      const a = parts[k]!, b = parts[k + 1]!;
      if (a === b) { this.report(a, "dato vacío"); continue; }
      if (this.pass === 1) { this.emit(0); this.emit(0); continue; }
      this.emitWordValue(this.value(text, a, b), a);
    }
  }

  classify(text: string, s: number, e: number, allowCond: boolean, mn: string): Operand {
    const w = text.slice(s, e).toLowerCase();
    const reg = REGS[w];
    if (reg !== undefined) return { key: reg, s: -1, e: -1, index: false };
    if (allowCond && CONDS.has(w)) return { key: w, s: -1, e: -1, index: false };
    if (w === "f" && mn === "in") return { key: "f", s: -1, e: -1, index: false };
    if (text.charCodeAt(s) === 40 && matchParen(text, s, e) === e - 1) {
      let a = s + 1, b = e - 1;
      while (a < b && isWs(text.charCodeAt(a))) a++;
      while (b > a && isWs(text.charCodeAt(b - 1))) b--;
      const inner = text.slice(a, b).toLowerCase();
      switch (inner) {
        case "bc": case "de": case "hl": case "sp": case "c":
          return { key: `(${inner})`, s: -1, e: -1, index: false };
        case "ix": case "iy":
          if (mn === "jp") return { key: `(${inner})`, s: -1, e: -1, index: false };
          return { key: `(${inner}+*)`, s: b, e: b, index: true };
      }
      if (inner.length > 2 && inner.charCodeAt(0) === 105 && (inner.charCodeAt(1) === 120 || inner.charCodeAt(1) === 121)) {
        let k = 2;
        while (k < inner.length && isWs(inner.charCodeAt(k))) k++;
        const c = inner.charCodeAt(k);
        if (c === 43 || c === 45) return { key: `(${inner.slice(0, 2)}+*)`, s: a + 2, e: b, index: true };
      }
      return { key: "(*)", s: a, e: b, index: false };
    }
    return { key: "*", s, e, index: false };
  }

  instruction(op: string, lop: string, text: string, s: number, e: number, opPos: number): void {
    let ins = this.rec.ins;
    if (ins === null) {
      ins = this.classifyInstruction(op, lop, text, s, e, opPos);
      if (ins === null) return;
    }
    const entry = ins.entry, ops = ins.ops, literal = ins.literal;
    if (this.pass === 1) {
      this.pc += entry.length;
      if (this.firstAddr === undefined) this.firstAddr = this.stmtPc;
      return;
    }
    let imm: Operand | undefined, disp: Operand | undefined;
    for (let k = 0; k < ops.length; k++) {
      const o = ops[k]!;
      if (o.index) disp = o;
      else if (o.s >= 0 && k !== literal) imm = o;
    }
    for (const t of entry.template) {
      if (t < 0x100) { this.emit(t); continue; }
      switch (t) {
        case OP_N:
          this.emitByteValue(imm ? this.value(text, imm.s, imm.e) : undefined, imm?.s ?? opPos);
          break;
        case OP_NN:
          this.emitWordValue(imm ? this.value(text, imm.s, imm.e) : undefined, imm?.s ?? opPos);
          break;
        case OP_D: {
          let d: number | undefined = 0;
          if (disp && disp.s < disp.e) d = this.value(text, disp.s, disp.e);
          if (d !== undefined && (d < -128 || d > 127)) this.report(disp!.s, `desplazamiento ${d} fuera de rango (-128..127)`);
          this.emit(d ?? 0);
          break;
        }
        case OP_E: {
          const target = imm ? this.value(text, imm.s, imm.e) : undefined;
          let rel = 0;
          if (target !== undefined) {
            rel = target - ((this.stmtPc + entry.length) & 0xffff);
            if (rel < -128 || rel > 127) {
              this.report(imm!.s, `salto relativo fuera de rango (${rel}; debe estar entre -128 y 127)`);
              rel = 0;
            }
          }
          this.emit(rel);
          break;
        }
      }
    }
  }

  /**
   * Encuentra la entrada de la tabla para la instrucción. En la pasada 1 guarda el
   * resultado en el registro de la línea para que la pasada 2 no repita el trabajo.
   */
  classifyInstruction(op: string, lop: string, text: string, s: number, e: number, opPos: number): InsRec | null {
    let mn = MN_ALIAS[lop] ?? lop;
    if (op === "?") {
      this.report(opPos, `carácter inesperado '${text[opPos]}'`);
      return null;
    }
    if (!MNEMONICS.has(mn)) {
      this.report(opPos, `instrucción o directiva desconocida '${op}'`);
      return null;
    }
    let parts = splitArgs(text, s, e);
    if (s === e) parts = [];
    // "ld b,rlc (ix+d)" → "rlc (ix+d),b" (sintaxis alternativa de las DDCB no documentadas).
    if (mn === "ld" && parts.length >= 4) {
      const src = text.slice(parts[2], e);
      const m = LD_ROT.exec(src);
      if (m) {
        mn = MN_ALIAS[m[1]!.toLowerCase()] ?? m[1]!.toLowerCase();
        const rs = parts[2]! + m[0].length;
        const inner = splitArgs(text, rs, e);
        parts = [...inner, parts[0]!, parts[1]!];
      }
    }
    if (mn === "exa") { mn = "ex"; parts = []; }
    const ops: Operand[] = [];
    const allowCond = COND_MN.has(mn);
    for (let k = 0; k < parts.length; k += 2) {
      if (parts[k] === parts[k + 1]) { this.report(parts[k]!, "falta un operando"); return null; }
      ops.push(this.classify(text, parts[k]!, parts[k + 1]!, allowCond && k === 0, mn));
    }
    // Alias habituales.
    if (lop === "exa") ops.push({ key: "af", s: -1, e: -1, index: false }, { key: "af'", s: -1, e: -1, index: false });
    if (mn === "ex" && ops.length === 2 && ops[0]!.key === "af" && ops[1]!.key === "af") ops[1]!.key = "af'";
    if (mn === "in" && ops.length === 1 && ops[0]!.key === "(c)") ops.unshift({ key: "f", s: -1, e: -1, index: false });
    if (mn === "jp" && ops.length === 1 && (ops[0]!.key === "hl" || ops[0]!.key === "ix" || ops[0]!.key === "iy")) ops[0]!.key = `(${ops[0]!.key})`;

    const keys = ops.map((o) => o.key);
    let entry = ISA_BY_KEY.get(buildKey(mn, keys));
    let literal = -1;
    let literalGuess = false;
    if (entry === undefined) {
      // Operandos numéricos fijos (bit 3, im 1, rst 38h, out (c),0).
      for (let k = 0; k < ops.length && entry === undefined; k++) {
        const o = ops[k]!;
        if (o.key !== "*") continue;
        const r = evaluate(text, o.s, o.e, this.env);
        const known = r.resolved && r.error === undefined;
        const v = known ? r.value : this.pass === 1 ? 0 : NaN;
        if (Number.isNaN(v)) continue;
        const k2 = keys.slice();
        k2[k] = String(v);
        entry = ISA_BY_KEY.get(buildKey(mn, k2));
        if (entry !== undefined) { literal = k; literalGuess = !known; }
      }
    }
    if (entry === undefined) {
      if (this.pass === 2) {
        // Mensaje más útil si el problema es un símbolo indefinido en un operando fijo.
        for (const o of ops) {
          if (o.key !== "*") continue;
          const r = evaluate(text, o.s, o.e, this.env);
          if (!r.resolved) { this.report(r.undefPos!, `símbolo no definido '${r.undefName}'`); return null; }
        }
      }
      this.report(opPos, `operandos no válidos para '${op}': ${text.slice(s, e) || "(ninguno)"}`);
      return null;
    }
    const ins: InsRec = { entry, ops, literal };
    // Un operando fijo que en la pasada 1 aún no tenía valor se vuelve a buscar en la 2.
    if (this.pass === 1 && !literalGuess) this.rec.ins = ins;
    return ins;
  }
}

interface LineRec {
  text: string;
  label: string | null;
  labelPos: number;
  op: string;
  lop: string;
  opPos: number;
  argS: number;
  argE: number;
  /** Instrucción ya clasificada en la pasada 1. */
  ins: InsRec | null;
}

interface InsRec {
  entry: IsaEntry;
  ops: Operand[];
  literal: number;
}

/** Separa etiqueta, operación y operandos de una línea. */
function parseLine(text: string): LineRec {
  const end = commentStart(text);
  // Etiqueta.
  let i = 0;
  let label: string | null = null;
  let labelPos = 0;
  let op = "";
  let opPos = 0;
  const c0 = text.charCodeAt(0);
  if (end > 0 && isIdentStart(c0)) {
    let j = 1;
    while (j < end && isIdentChar(text.charCodeAt(j))) j++;
    const w = text.slice(0, j);
    const colon = j < end && text.charCodeAt(j) === 58 && text.charCodeAt(j + 1) !== 61;
    if (!colon && isKeyword(w.toLowerCase()) && !nextIsDefiner(text, j, end)) {
      op = w;
      opPos = 0;
      i = j;
    } else {
      label = w;
      i = colon ? (text.charCodeAt(j + 1) === 58 ? j + 2 : j + 1) : j;
    }
  }
  if (op === "") {
    while (i < end && isWs(text.charCodeAt(i))) i++;
    if (i < end) {
      const c = text.charCodeAt(i);
      if (c === 61) { op = "="; opPos = i; i++; }
      else if (c === 58 && text.charCodeAt(i + 1) === 61) { op = ":="; opPos = i; i += 2; }
      else if (isIdentStart(c)) {
        let j = i + 1;
        while (j < end && isIdentChar(text.charCodeAt(j))) j++;
        const w = text.slice(i, j);
        if (label === null && j < end && text.charCodeAt(j) === 58 && text.charCodeAt(j + 1) !== 61) {
          // Etiqueta sangrada con ':'.
          label = w;
          labelPos = i;
          i = j + 1;
          if (i < end && text.charCodeAt(i) === 58) i++;
          while (i < end && isWs(text.charCodeAt(i))) i++;
          if (i < end) {
            const c2 = text.charCodeAt(i);
            if (c2 === 61) { op = "="; opPos = i; i++; }
            else if (c2 === 58 && text.charCodeAt(i + 1) === 61) { op = ":="; opPos = i; i += 2; }
            else if (isIdentStart(c2)) {
              let k = i + 1;
              while (k < end && isIdentChar(text.charCodeAt(k))) k++;
              op = text.slice(i, k);
              opPos = i;
              i = k;
            } else { op = "?"; opPos = i; }
          }
        } else if (label === null && nextIsDefiner(text, j, end)) {
          // Etiqueta sangrada sin ':' delante de EQU, =, MACRO...
          label = w;
          labelPos = i;
          i = j;
          while (i < end && isWs(text.charCodeAt(i))) i++;
          const c2 = text.charCodeAt(i);
          if (c2 === 61) { op = "="; opPos = i; i++; }
          else if (c2 === 58) { op = ":="; opPos = i; i += 2; }
          else {
            let k = i;
            while (k < end && isIdentChar(text.charCodeAt(k))) k++;
            op = text.slice(i, k);
            opPos = i;
            i = k;
          }
        } else {
          op = w;
          opPos = i;
          i = j;
        }
      } else { op = "?"; opPos = i; }
    }
  }
  let lop = op.toLowerCase();
  if (lop.length > 1 && lop.charCodeAt(0) === 46 && DIRECTIVES.has(lop.slice(1))) lop = lop.slice(1);
  // Cadena interna: los switch/comparaciones con literales van por puntero.
  lop = KNOWN_OPS.get(lop) ?? lop;
  let argS = i;
  while (argS < end && isWs(text.charCodeAt(argS))) argS++;
  let argE = end;
  while (argE > argS && isWs(text.charCodeAt(argE - 1))) argE--;
  return { text, label, labelPos, op, lop, opPos, argS, argE, ins: null };
}

function isKeyword(w: string): boolean {
  if (w.charCodeAt(0) === 46) return DIRECTIVES.has(w.slice(1));
  return DIRECTIVES.has(w) || MNEMONICS.has(w);
}

function nextIsDefiner(text: string, j: number, end: number): boolean {
  let k = j;
  while (k < end && isWs(text.charCodeAt(k))) k++;
  const c = text.charCodeAt(k);
  if (c === 61) return text.charCodeAt(k + 1) !== 61;
  if (c === 58) return text.charCodeAt(k + 1) === 61;
  if (k === j) return false;
  let m = k;
  while (m < end && isIdentChar(text.charCodeAt(m))) m++;
  const w = text.slice(k, m).toLowerCase();
  return w === "equ" || w === "defl" || w === "macro";
}

function stripAngle(s: string): string {
  return s.length >= 2 && s[0] === "<" && s[s.length - 1] === ">" ? s.slice(1, -1).trim() : s;
}

/** Argumentos de una llamada a macro: comas de nivel 0; <...> agrupa texto con comas. */
function macroArgs(text: string, s: number, e: number): string[] {
  const out: string[] = [];
  if (s >= e) return out;
  let i = s;
  for (;;) {
    while (i < e && isWs(text.charCodeAt(i))) i++;
    let arg = "";
    if (i < e && text.charCodeAt(i) === 60) {
      // <a,b,c>: el contenido sin los corchetes.
      let depth = 0, j = i;
      for (; j < e; j++) {
        const c = text.charCodeAt(j);
        if (c === 39 || c === 34) { j = Math.min(skipString(text, j), e) - 1; continue; }
        if (c === 60) depth++;
        else if (c === 62 && --depth === 0) break;
      }
      arg = text.slice(i + 1, j);
      i = j + 1;
      while (i < e && text.charCodeAt(i) !== 44) i++;
    } else {
      let depth = 0, j = i;
      for (; j < e; j++) {
        const c = text.charCodeAt(j);
        if (c === 39 || c === 34) {
          if (c === 39 && isAfQuote(text, j)) continue;
          j = Math.min(skipString(text, j), e) - 1;
          continue;
        }
        if (c === 40) depth++;
        else if (c === 41) depth--;
        else if (c === 44 && depth <= 0) break;
      }
      arg = text.slice(i, j).trim();
      i = j;
    }
    out.push(arg);
    if (i >= e) break;
    i++; // coma
  }
  return out;
}

/**
 * Sustituye parámetros y nombres LOCAL en una línea del cuerpo de una macro. Sólo
 * identificadores completos, fuera de cadenas y comentarios. "&nombre" (concatenación
 * de M80) se sustituye sin el "&".
 */
function substitute(line: string, map: Map<string, string>): string {
  let out = "";
  let last = 0;
  const n = line.length;
  for (let i = 0; i < n; ) {
    const c = line.charCodeAt(i);
    if (c === 59) break;
    if (c === 39 || c === 34) {
      if (c === 39 && isAfQuote(line, i)) { i++; continue; }
      i = skipString(line, i);
      continue;
    }
    if ((c >= 48 && c <= 57) || ((c === 36 || c === 35 || c === 37) && i + 1 < n && isAlnum(line.charCodeAt(i + 1)))) {
      i++;
      while (i < n && isAlnum(line.charCodeAt(i))) i++;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentChar(line.charCodeAt(j))) j++;
      const rep = map.get(line.slice(i, j).toLowerCase());
      if (rep !== undefined) {
        let a = i;
        // "&nombre" (M80) sólo si el "&" no puede ser el operador AND: "x&n" es una expresión.
        if (a > last && line.charCodeAt(a - 1) === 38 && (a < 2 || !isOperandEnd(line.charCodeAt(a - 2)))) a--;
        out += line.slice(last, a) + rep;
        last = j;
      }
      i = j;
      continue;
    }
    i++;
  }
  return last === 0 ? line : out + line.slice(last);
}

export function splitLines(src: string): string[] {
  return src.split(/\r\n|\n|\r/);
}

export function assemble(source: string, opts: AsmOptions = {}): AsmResult {
  const as = new Assembler(opts);
  const lines = splitLines(source);
  const org = (opts.org ?? 0x8000) & 0xffff;
  const defines = opts.defines ?? {};
  for (let pass = 1; pass <= 2; pass++) {
    as.pass = pass;
    as.pc = org;
    as.global = "";
    as.macroPrefix = null;
    as.macroDepth = 0;
    as.ended = false;
    as.ifStack = [];
    as.macros = new Map();
    as.collect = null;
    as.expansion = 0;
    as.definedThisPass = new Set();
    as.redefinable = new Set();
    as.p1idx = 0;
    as.recIdx = 0;
    as.firstAddr = undefined;
    as.siteCol = 1;
    for (const k of Object.keys(defines)) {
      as.symbols.set(k, defines[k]! | 0);
      as.definedThisPass.add(k);
    }
    as.runLines(lines, undefined);
    const open = as.collect as Collect | null;
    if (open !== null) {
      as.siteLine = lines.length;
      as.report(0, open.kind === "macro" ? "MACRO sin ENDM" : "REPT sin ENDR");
      as.collect = null;
    }
    if (as.ifStack.length) {
      as.siteLine = lines.length;
      as.report(0, "IF sin ENDIF");
    }
    if (pass === 1) as.resolvePending();
  }

  // Segmentos: tramos contiguos de memoria escrita.
  const segments: AsmSegment[] = [];
  const w = as.written;
  for (let a = 0; a < 65536; ) {
    if (!w[a]) { a++; continue; }
    let b = a;
    while (b < 65536 && w[b]) b++;
    segments.push({ addr: a, bytes: as.mem.slice(a, b) });
    a = b;
  }

  let errors = as.p1Errors.concat(as.errors);
  errors.sort((x, y) => {
    const fx = x.file ?? "", fy = y.file ?? "";
    if (fx !== fy) return fx < fy ? -1 : 1;
    return x.line - y.line || x.col - y.col;
  });
  if (errors.length > as.maxErrors) {
    const last = errors[as.maxErrors - 1]!;
    errors = errors.slice(0, as.maxErrors);
    errors.push({ line: last.line, col: 1, msg: "demasiados errores; se omiten los demás", severity: "error" });
  }

  const symbols = new Map<string, number>();
  for (const [k, v] of as.symbols) if (!k.includes("??")) symbols.set(k, v);

  return {
    segments,
    entry: as.entry ?? as.firstAddr ?? org,
    symbols,
    lineMap: as.lineMap,
    errors,
  };
}

function isAlnum(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
}

/** ¿El carácter puede terminar un operando? (entonces un '&' que le sigue es AND) */
function isOperandEnd(c: number): boolean {
  return isIdentChar(c) || c === 41 || c === 39 || c === 34 || c === 36;
}
