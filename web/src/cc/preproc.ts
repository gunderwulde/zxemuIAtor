// Preprocesador (K1): #include, #define (objeto y función, # y ##), #undef,
// #if/#ifdef/#ifndef/#elif/#else/#endif con defined(), #error, #warning,
// #pragma once, #pragma link "fichero". Trabaja sobre tokens del lexer.

import { lex, type Token } from "./lexer";

export interface Diag { file: string; line: number; col: number; msg: string; severity: "error" | "warning" }

interface Macro { params?: string[]; variadic?: boolean; body: Token[] }

export type Resolver = (name: string, from: string, angle: boolean) => { name: string; text: string } | undefined;

const MAX_INCLUDE_DEPTH = 32;

export class Preprocessor {
  readonly macros = new Map<string, Macro>();
  private once = new Set<string>();
  readonly links: { name: string; from: Token }[] = [];
  /** `#pragma org N`: dirección del programa (la primera que se vea). */
  org: number | undefined;
  private linkSeen = new Set<string>();

  constructor(private resolve: Resolver, readonly diags: Diag[]) {
    const def = (k: string, v: string) => this.macros.set(k, { body: lex(v, "<builtin>", []).slice(0, -1) });
    def("__Z80__", "1");
    def("__ZX48__", "1");
    def("__K1CC__", "1");
  }

  private err(t: { file: string; line: number; col: number }, msg: string, severity: "error" | "warning" = "error") {
    this.diags.push({ file: t.file, line: t.line, col: t.col, msg, severity });
  }

  /** Preprocesa un fichero completo y devuelve los tokens (sin EOF). */
  run(name: string, text: string, depth = 0): Token[] {
    const lexErr: { file: string; line: number; col: number; msg: string }[] = [];
    const toks = lex(text, name, lexErr);
    for (const e of lexErr) this.err(e, e.msg);
    const out: Token[] = [];
    // Pila de condicionales: activo = esta rama se procesa; done = ya se tomó alguna rama.
    const cond: { active: boolean; done: boolean; else: boolean; tok: Token }[] = [];
    const active = () => cond.length === 0 || cond[cond.length - 1]!.active;
    let chunk: Token[] = [];
    const flush = () => {
      if (chunk.length) { this.expand(chunk, out); chunk = []; }
    };
    let i = 0;
    while (toks[i]!.k !== "eof") {
      const t = toks[i]!;
      if (!(t.bol && t.k === "punc" && t.v === "#")) {
        // Línea normal.
        let j = i + 1;
        while (toks[j]!.k !== "eof" && !toks[j]!.bol) j++;
        if (active()) for (let q = i; q < j; q++) chunk.push(toks[q]!);
        i = j;
        continue;
      }
      // Directiva: tokens hasta el fin de línea.
      let j = i + 1;
      while (toks[j]!.k !== "eof" && !toks[j]!.bol) j++;
      const line = toks.slice(i + 1, j);
      i = j;
      const d = line[0];
      if (!d) continue; // "#" solo
      const dn = d.v;
      const parentActive = cond.length === 0 || (cond.length === 1 ? true : cond[cond.length - 2]!.active);
      switch (dn) {
        case "if": case "ifdef": case "ifndef": {
          let v = false;
          if (active()) {
            if (dn === "if") v = this.evalIf(line.slice(1), d);
            else {
              const id = line[1];
              if (!id || id.k !== "id") this.err(d, `#${dn} sin nombre`);
              else v = this.macros.has(id.v) === (dn === "ifdef");
            }
          }
          const act = active() && v;
          cond.push({ active: act, done: act || !active(), else: false, tok: d });
          continue;
        }
        case "elif": {
          const c = cond[cond.length - 1];
          if (!c) { this.err(d, "#elif sin #if"); continue; }
          if (c.else) this.err(d, "#elif después de #else");
          if (c.done) { c.active = false; continue; }
          const v = parentActive && this.evalIf(line.slice(1), d);
          c.active = v; c.done = v;
          continue;
        }
        case "else": {
          const c = cond[cond.length - 1];
          if (!c) { this.err(d, "#else sin #if"); continue; }
          if (c.else) this.err(d, "#else repetido");
          c.else = true;
          c.active = !c.done && parentActive;
          c.done = true;
          continue;
        }
        case "endif":
          if (!cond.pop()) this.err(d, "#endif sin #if");
          continue;
      }
      if (!active()) continue;
      flush();
      switch (dn) {
        case "define": this.define(line, d); break;
        case "undef":
          if (line[1]?.k === "id") this.macros.delete(line[1].v);
          else this.err(d, "#undef sin nombre");
          break;
        case "include": {
          let arg = line.slice(1);
          if (arg.length && arg[0]!.k === "id") { const e: Token[] = []; this.expand(arg, e); arg = e; }
          let fname: string | undefined, angle = false;
          if (arg.length === 1 && arg[0]!.k === "str") fname = String.fromCharCode(...arg[0]!.bytes!);
          else if (arg.length >= 3 && arg[0]!.v === "<" && arg[arg.length - 1]!.v === ">") {
            angle = true;
            fname = this.joinRaw(arg.slice(1, -1));
          }
          if (fname === undefined) { this.err(d, "#include espera \"fichero\" o <fichero>"); break; }
          if (depth >= MAX_INCLUDE_DEPTH) { this.err(d, `#include anidado más de ${MAX_INCLUDE_DEPTH} niveles (¿recursivo?)`); break; }
          const r = this.resolve(fname, name, angle);
          if (!r) { this.err(arg[0]!, `no se encuentra el fichero '${fname}'`); break; }
          if (this.once.has(r.name)) break;
          for (const tk of this.run(r.name, r.text, depth + 1)) out.push(tk);
          break;
        }
        case "pragma": {
          const p = line[1];
          if (p?.v === "once") this.once.add(name);
          else if (p?.v === "link") {
            const a = line[2];
            if (!a || a.k !== "str") { this.err(p, "#pragma link espera \"fichero\""); break; }
            const f = String.fromCharCode(...a.bytes!);
            if (!this.linkSeen.has(f)) { this.linkSeen.add(f); this.links.push({ name: f, from: a }); }
          }
          else if (p?.v === "org") {
            const a = line[2];
            if (!a || a.k !== "num" || a.n === undefined || a.n < 0 || a.n > 0xffff) { this.err(p, "#pragma org espera una dirección 0..65535"); break; }
            this.org ??= a.n;
          }
          // Otros #pragma se ignoran (C99 6.10.6).
          break;
        }
        case "error": this.err(d, "#error " + this.joinRaw(line.slice(1))); break;
        case "warning": this.err(d, "#warning " + this.joinRaw(line.slice(1)), "warning"); break;
        case "line": break;
        default: this.err(d, `directiva desconocida #${dn}`);
      }
    }
    flush();
    for (const c of cond) this.err(c.tok, `#${c.tok.v} sin #endif`);
    return out;
  }

  private joinRaw(ts: Token[]): string {
    return ts.map((t) => t.v).join("");
  }

  private define(line: Token[], d: Token) {
    const nameT = line[1];
    if (!nameT || nameT.k !== "id") { this.err(d, "#define sin nombre"); return; }
    let k = 2;
    const m: Macro = { body: [] };
    const next = line[2];
    // Función solo si "(" va pegado al nombre.
    if (next && next.v === "(" && next.line === nameT.line && next.col === nameT.col + nameT.v.length) {
      m.params = [];
      k = 3;
      for (;;) {
        const t = line[k];
        if (!t) { this.err(nameT, "falta ')' en los parámetros de la macro"); return; }
        if (t.v === ")") { k++; break; }
        if (t.v === "...") { m.variadic = true; m.params.push("__VA_ARGS__"); k++; continue; }
        if (t.k === "id") { m.params.push(t.v); k++; }
        else { this.err(t, "parámetro de macro no válido"); return; }
        if (line[k]?.v === ",") k++;
      }
    }
    m.body = line.slice(k);
    this.macros.set(nameT.v, m);
  }

  /**
   * Expande macros de `inp` y añade el resultado a `out`. Reescaneo con conjuntos de
   * ocultación por token (cada token recuerda qué macros lo produjeron).
   */
  expand(inp: Token[], out: Token[]): void {
    const q = inp.slice();
    let i = 0;
    while (i < q.length) {
      const t = q[i]!;
      if (t.k !== "id") { out.push(t); i++; continue; }
      if (t.v === "__LINE__") { out.push({ ...t, k: "num", v: String(t.line), n: t.line }); i++; continue; }
      if (t.v === "__FILE__") { out.push({ ...t, k: "str", v: JSON.stringify(t.file), bytes: [...t.file].map((c) => c.charCodeAt(0) & 0xff) }); i++; continue; }
      const m = this.macros.get(t.v);
      if (!m || t.hide?.has(t.v)) { out.push(t); i++; continue; }
      const hide = new Set(t.hide ?? []);
      hide.add(t.v);
      const at = (b: Token): Token => ({ ...b, file: t.file, line: t.line, col: t.col, bol: false, hide: new Set([...hide, ...(b.hide ?? [])]) });
      if (!m.params) {
        q.splice(i, 1, ...m.body.map(at));
        continue;
      }
      if (q[i + 1]?.v !== "(") { out.push(t); i++; continue; }
      // Argumentos (paréntesis equilibrados, comas a profundidad 0).
      const args: Token[][] = [[]];
      let depth = 0, j = i + 2;
      for (; j < q.length; j++) {
        const a = q[j]!;
        if (a.v === "(" && a.k === "punc") depth++;
        else if (a.v === ")" && a.k === "punc") { if (depth === 0) break; depth--; }
        else if (a.v === "," && a.k === "punc" && depth === 0 && !(m.variadic && args.length >= m.params.length)) { args.push([]); continue; }
        args[args.length - 1]!.push(a);
      }
      if (j >= q.length) { this.err(t, `falta ')' en la llamada a la macro '${t.v}'`); out.push(t); i++; continue; }
      if (m.params.length === 0 && args.length === 1 && args[0]!.length === 0) args.pop();
      if (m.variadic && args.length === m.params.length - 1) args.push([]);
      if (args.length !== m.params.length) {
        this.err(t, `la macro '${t.v}' espera ${m.params.length} argumentos y recibe ${args.length}`);
        i = j + 1;
        continue;
      }
      const res: Token[] = [];
      const body = m.body;
      for (let b = 0; b < body.length; b++) {
        const bt = body[b]!;
        if (bt.v === "#" && bt.k === "punc" && body[b + 1]?.k === "id" && m.params.includes(body[b + 1]!.v)) {
          const arg = args[m.params.indexOf(body[b + 1]!.v)]!;
          const s = arg.map((x, n) => (n > 0 && (x.col !== arg[n - 1]!.col + arg[n - 1]!.v.length || x.line !== arg[n - 1]!.line) ? " " : "") + x.v).join("");
          res.push({ ...at(bt), k: "str", v: JSON.stringify(s), bytes: [...s].map((c) => c.charCodeAt(0) & 0xff) });
          b++;
          continue;
        }
        const pi = bt.k === "id" ? m.params.indexOf(bt.v) : -1;
        if (pi >= 0) for (const a of args[pi]!) res.push(at(a));
        else res.push(at(bt));
      }
      // ## : pega el token anterior con el siguiente.
      for (let p = 0; p < res.length; p++) {
        if (res[p]!.v === "##" && res[p]!.k === "punc") {
          const a = res[p - 1], b = res[p + 1];
          if (!a || !b) { this.err(t, "## en el extremo de la macro"); res.splice(p, 1); p--; continue; }
          const pasted = lex(a.v + b.v, t.file, []);
          const nt = pasted.length === 2 ? { ...pasted[0]!, file: t.file, line: t.line, col: t.col, bol: false, hide: a.hide } : a;
          if (pasted.length !== 2) this.err(t, `'##' no forma un token válido con '${a.v}' y '${b.v}'`);
          res.splice(p - 1, 3, nt);
          p--;
        }
      }
      q.splice(i, j + 1 - i, ...res);
    }
  }

  // ---- #if ----------------------------------------------------------------
  private evalIf(ts: Token[], d: Token): boolean {
    // defined X / defined(X) antes de expandir.
    const pre: Token[] = [];
    for (let k = 0; k < ts.length; k++) {
      const t = ts[k]!;
      if (t.k === "id" && t.v === "defined") {
        let name: Token | undefined;
        if (ts[k + 1]?.v === "(") { name = ts[k + 2]; k += 3; }
        else { name = ts[k + 1]; k += 1; }
        pre.push({ ...t, k: "num", v: "", n: name && this.macros.has(name.v) ? 1 : 0 });
        continue;
      }
      pre.push(t);
    }
    const e: Token[] = [];
    this.expand(pre, e);
    let p = 0;
    let bad = false;
    const peek = () => e[p];
    const fail = (msg: string) => { if (!bad) this.err(e[p] ?? d, msg); bad = true; return 0; };
    const prim = (): number => {
      const t = e[p++];
      if (!t) return fail("expresión de #if incompleta");
      if (t.k === "num" || t.k === "chr") return t.n ?? 0;
      if (t.k === "id") return 0; // identificador no definido = 0 (C99 6.10.1)
      if (t.v === "(") { const v = ternary(); if (e[p]?.v !== ")") return fail("falta ')' en #if"); p++; return v; }
      if (t.v === "-") return -prim() | 0;
      if (t.v === "+") return prim();
      if (t.v === "~") return ~prim();
      if (t.v === "!") return prim() ? 0 : 1;
      return fail(`'${t.v}' inesperado en #if`);
    };
    const BIN: Record<string, [number, (a: number, b: number) => number]> = {
      "*": [10, (a, b) => Math.imul(a, b)], "/": [10, (a, b) => (b ? (a / b) | 0 : fail("división por cero en #if"))], "%": [10, (a, b) => (b ? a % b : fail("división por cero en #if"))],
      "+": [9, (a, b) => (a + b) | 0], "-": [9, (a, b) => (a - b) | 0],
      "<<": [8, (a, b) => a << b], ">>": [8, (a, b) => a >> b],
      "<": [7, (a, b) => +(a < b)], ">": [7, (a, b) => +(a > b)], "<=": [7, (a, b) => +(a <= b)], ">=": [7, (a, b) => +(a >= b)],
      "==": [6, (a, b) => +(a === b)], "!=": [6, (a, b) => +(a !== b)],
      "&": [5, (a, b) => a & b], "^": [4, (a, b) => a ^ b], "|": [3, (a, b) => a | b],
      "&&": [2, (a, b) => +(!!a && !!b)], "||": [1, (a, b) => +(!!a || !!b)],
    };
    const bin = (minPrec: number): number => {
      let l = prim();
      for (;;) {
        const t = peek();
        const op = t && t.k === "punc" ? BIN[t.v] : undefined;
        if (!op || op[0] < minPrec) return l;
        p++;
        const r = bin(op[0] + 1);
        l = op[1](l, r);
      }
    };
    const ternary = (): number => {
      const c = bin(1);
      if (peek()?.v === "?") {
        p++;
        const a = ternary();
        if (peek()?.v !== ":") return fail("falta ':' en #if");
        p++;
        const b = ternary();
        return c ? a : b;
      }
      return c;
    };
    if (e.length === 0) { this.err(d, "#if sin expresión"); return false; }
    const v = ternary();
    if (p < e.length) fail(`'${e[p]!.v}' inesperado en #if`);
    return !bad && v !== 0;
  }
}
