// Parser + análisis semántico (K1). Descenso recursivo sobre los tokens preprocesados;
// construye directamente el AST tipado (types.ts) con las conversiones de C explícitas
// (promociones enteras, conversiones aritméticas usuales, decaimiento de arrays, escala
// de la aritmética de punteros) y pliega constantes.

import type { Token } from "./lexer";
import type { Diag } from "./preproc";
import {
  T_CHAR, T_INT, T_SCHAR, T_UINT, T_VOID, T_VOIDP,
  isChar, isInt, isPtr, isScalar, norm, sameType, sizeOf, typeStr, unqual, withConst,
  type BinOp, type CmpOp, type Expr, type FuncInfo, type Init, type InitItem, type Pos, type Stmt,
  type StructInfo, type Sym, type Type, type VarSym,
} from "./types";

class CErr extends Error {
  constructor(readonly pos: Pos, msg: string) { super(msg); }
}

type TagSym = { kind: "struct"; s: StructInfo } | { kind: "enum" };

/** Estado compartido entre ficheros (enlace de símbolos externos). */
export class Program {
  globals: VarSym[] = [];
  funcs: FuncInfo[] = [];
  externs = new Map<string, VarSym | FuncInfo>();
  /** __asm a nivel de fichero. */
  asmBlocks: { text: string; file: string; line: number; refs: Set<VarSym | FuncInfo> }[] = [];
  staticCount = 0;
}

const TYPE_KW = new Set(["void", "char", "short", "int", "long", "signed", "unsigned", "struct", "union", "enum", "const", "volatile",
  "typedef", "static", "extern", "auto", "register", "inline", "__naked", "float", "double"]);

const MAX_ERRORS = 100;

export function parseFile(toks: Token[], fileIdx: number, prog: Program, diags: Diag[]): void {
  new Parser(toks, fileIdx, prog, diags).file();
}

class Parser {
  private p = 0;
  private scopes: Map<string, Sym>[] = [new Map()];
  private tags: Map<string, TagSym>[] = [new Map()];
  private fn: FuncInfo | null = null;
  private refs: Set<VarSym | FuncInfo> | null = null;
  private curOff = 0;
  private maxOff = 0;
  private labelN = 0;
  private breakable = 0;
  private loops = 0;
  private switches: { cases: { v: number; label: string }[]; def?: string; t: Type }[] = [];
  private eofTok: Token;

  constructor(private toks: Token[], private fileIdx: number, private prog: Program, private diags: Diag[]) {
    const last = toks[toks.length - 1];
    this.eofTok = { k: "eof", v: "", file: last?.file ?? "", line: last?.line ?? 1, col: (last?.col ?? 1) + (last?.v.length ?? 0), bol: true };
  }

  // ---- tokens -------------------------------------------------------------
  private peek(o = 0): Token { return this.toks[this.p + o] ?? this.eofTok; }
  private next(): Token { const t = this.peek(); if (this.p < this.toks.length) this.p++; return t; }
  private is(v: string, o = 0): boolean { const t = this.peek(o); return (t.k === "punc" || t.k === "id") && t.v === v; }
  private accept(v: string): boolean { if (this.is(v)) { this.p++; return true; } return false; }
  private pos(t: Token = this.peek()): Pos { return { file: t.file, line: t.line, col: t.col }; }
  private expect(v: string, what?: string): Token {
    if (!this.is(v)) {
      const t = this.peek();
      // Si falta ';' o ')' se señala el final del token anterior (como gcc).
      const prev = this.toks[this.p - 1];
      const at = (v === ";" || v === ")") && prev && prev.line !== t.line ? { file: prev.file, line: prev.line, col: prev.col + prev.v.length } : this.pos(t);
      throw new CErr(at, `se esperaba '${v}'${what ? " " + what : ""} y hay ${t.k === "eof" ? "fin de fichero" : `'${t.v}'`}`);
    }
    return this.next();
  }
  private err(pos: Pos, msg: string) {
    if (this.diags.filter((d) => d.severity === "error").length < MAX_ERRORS) this.diags.push({ ...pos, msg, severity: "error" });
  }
  private warn(pos: Pos, msg: string) { this.diags.push({ ...pos, msg, severity: "warning" }); }

  private sync() {
    let depth = 0;
    while (this.peek().k !== "eof") {
      const t = this.peek();
      if (t.v === ";" && depth === 0) { this.p++; return; }
      if (t.v === "{") depth++;
      if (t.v === "}") { if (depth === 0) return; depth--; if (depth === 0) { this.p++; return; } }
      this.p++;
    }
  }

  // ---- ámbitos ----------------------------------------------------------------
  private lookup(name: string): Sym | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) { const s = this.scopes[i]!.get(name); if (s) return s; }
    return undefined;
  }
  private lookupTag(name: string): TagSym | undefined {
    for (let i = this.tags.length - 1; i >= 0; i--) { const s = this.tags[i]!.get(name); if (s) return s; }
    return undefined;
  }
  private pushScope() { this.scopes.push(new Map()); this.tags.push(new Map()); }
  private popScope() { this.scopes.pop(); this.tags.pop(); }
  private declare(name: string, s: Sym, pos: Pos) {
    const sc = this.scopes[this.scopes.length - 1]!;
    const old = sc.get(name);
    if (old && !(old.kind === "typedef" && s.kind === "typedef" && sameType(old.type, s.type))) {
      this.err(pos, `'${name}' redeclarado en el mismo ámbito`);
    }
    sc.set(name, s);
  }
  private isTypeStart(t: Token = this.peek()): boolean {
    if (t.k !== "id") return false;
    if (TYPE_KW.has(t.v)) return true;
    const s = this.lookup(t.v);
    return s?.kind === "typedef";
  }
  private addRef(r: VarSym | FuncInfo) { this.refs?.add(r); }

  // ---- fichero ------------------------------------------------------------------
  file() {
    while (this.peek().k !== "eof") {
      const p0 = this.p;
      try {
        this.external();
      } catch (e) {
        if (!(e instanceof CErr)) throw e;
        this.err(e.pos, e.message);
        this.sync();
        // Un '}' suelto a nivel de fichero: sync no lo consume; hay que avanzar.
        if (this.p === p0 || this.is("}")) this.p++;
      }
    }
  }

  private external() {
    const t = this.peek();
    if (t.k === "asm") {
      this.next();
      this.prog.asmBlocks.push({ text: t.v, file: t.file, line: t.asmLine ?? t.line, refs: new Set() });
      this.accept(";");
      return;
    }
    if (this.accept(";")) return;
    const specPos = this.pos();
    const sp = this.specs();
    if (!sp) throw new CErr(specPos, `se esperaba una declaración y hay '${t.v}'`);
    if (this.accept(";")) return; // struct S {...}; o enum {...};
    let first = true;
    for (;;) {
      const dpos = this.pos();
      const d = this.declarator(false);
      if (!d.name) throw new CErr(dpos, "falta el nombre en la declaración");
      let type = d.wrap(sp.t);
      const naked = sp.naked || this.accept("__naked");
      if (type.k === "func") {
        if (sp.storage === "typedef") { this.declare(d.name, { kind: "typedef", type }, d.pos); }
        else {
          const f = this.declareFunc(d.name, type, d.pos, sp.storage === "static", naked);
          if (first && this.is("{")) { this.funcBody(f, d.params ?? []); return; }
        }
      } else if (sp.storage === "typedef") {
        this.declare(d.name, { kind: "typedef", type }, d.pos);
      } else {
        this.globalVar(d.name, type, d.pos, sp.storage, sp.storage === "static");
        type = this.lookupVarType(d.name) ?? type;
      }
      first = false;
      if (this.accept(",")) continue;
      this.expect(";");
      return;
    }
  }

  private lookupVarType(name: string): Type | undefined {
    const s = this.lookup(name);
    return s?.kind === "var" ? s.type : undefined;
  }

  private declareFunc(name: string, type: Extract<Type, { k: "func" }>, pos: Pos, isStatic: boolean, naked: boolean): FuncInfo {
    if (type.ret.k === "array" || type.ret.k === "func") this.err(pos, "una función no puede devolver un array ni una función");
    if (type.ret.k === "struct") this.err(pos, "devolver structs por valor no está soportado (usa un puntero)");
    const existing = this.lookup(name);
    let f: FuncInfo | undefined;
    if (existing?.kind === "func") f = existing.f;
    else if (!isStatic) { const e = this.prog.externs.get(name); if (e && "refs" in e && "naked" in e) f = e as FuncInfo; }
    if (existing && existing.kind !== "func" && this.scopes.length === 1) this.err(pos, `'${name}' ya está declarado como otra cosa`);
    if (f) {
      if (!sameType(f.type, type)) this.err(pos, `declaraciones incompatibles de '${name}': ${typeStr(f.type)} y ${typeStr(type)}`);
      if (!f.type.params && type.params) f.type = type;
      f.naked ||= naked;
    } else {
      f = { name, label: "_" + name, type, pos, defined: false, isStatic, naked, refs: new Set(), fileIdx: this.fileIdx };
      this.prog.funcs.push(f);
      if (!isStatic) this.prog.externs.set(name, f);
    }
    this.scopes[0]!.set(name, { kind: "func", f });
    if (this.scopes.length > 1) this.scopes[this.scopes.length - 1]!.set(name, { kind: "func", f });
    return f;
  }

  private globalVar(name: string, type: Type, pos: Pos, storage: string | undefined, isStatic: boolean) {
    const isExtern = storage === "extern";
    if (type.k === "void") { this.err(pos, `variable '${name}' de tipo void`); type = T_INT; }
    let v: VarSym | undefined;
    const ex = this.scopes[0]!.get(name);
    if (ex?.kind === "var") v = ex;
    else if (!isStatic) { const e = this.prog.externs.get(name); if (e && "kind" in e) v = e; }
    if (ex && ex.kind !== "var") this.err(pos, `'${name}' ya está declarado como otra cosa`);
    if (v) {
      if (!sameType(unqual(v.type), unqual(type))) this.err(pos, `tipos incompatibles para '${name}': ${typeStr(v.type)} y ${typeStr(type)}`);
      else if (v.type.k === "array" && v.type.n === undefined && type.k === "array" && type.n !== undefined) v.type = type;
    } else {
      v = { kind: "var", name, type, storage: "global", label: "_" + name, off: 0, pos, isStatic, fileIdx: this.fileIdx, refs: new Set(), isConst: !!type.c };
      this.prog.globals.push(v);
      if (!isStatic) this.prog.externs.set(name, v);
    }
    if (!isExtern) v.defined = true;
    v.extern = isExtern && !v.defined;
    this.scopes[0]!.set(name, v);
    if (this.accept("=")) {
      if (isExtern) this.warn(pos, `'${name}' es extern y tiene inicializador`);
      if (v.init) this.err(pos, `'${name}' inicializado dos veces`);
      const save = this.refs;
      this.refs = v.refs!;
      v.init = this.initializer(v.type, pos);
      this.refs = save;
      if (v.type.k === "array" && v.type.n === undefined) v.type = { ...v.type, n: v.init.size / sizeOf(v.type.of) };
      for (const it of v.init.items) if (!constAddr(it.e)) this.err(it.e.pos, "el inicializador de una variable global debe ser constante");
      v.defined = true;
      v.extern = false;
    }
  }

  // ---- especificadores y declaradores -----------------------------------------
  private specs(): { t: Type; storage?: string; naked: boolean } | null {
    let storage: string | undefined;
    let isConst = false, naked = false;
    let base: Type | undefined;
    let nSigned = 0, nUnsigned = 0, nShort = 0, nInt = 0, nChar = 0, nVoid = 0, nLong = 0;
    let any = false;
    const startPos = this.pos();
    for (;;) {
      const t = this.peek();
      if (t.k !== "id") break;
      const v = t.v;
      if (v === "typedef" || v === "static" || v === "extern" || v === "auto" || v === "register") {
        if (storage && storage !== v) this.err(this.pos(t), `'${v}' y '${storage}' juntos`);
        storage = v === "auto" || v === "register" ? storage : v;
      } else if (v === "const") isConst = true;
      else if (v === "volatile" || v === "inline") { /* sin efecto: no hay optimizador que lo necesite */ }
      else if (v === "__naked") naked = true;
      else if (v === "void") nVoid++;
      else if (v === "char") nChar++;
      else if (v === "short") nShort++;
      else if (v === "int") nInt++;
      else if (v === "long") nLong++;
      else if (v === "signed") nSigned++;
      else if (v === "unsigned") nUnsigned++;
      else if (v === "float" || v === "double") { this.err(this.pos(t), `'${v}' no está soportado (no hay coma flotante)`); nInt++; }
      else if (v === "struct" || v === "union") { this.next(); base = this.structSpec(t); any = true; continue; }
      else if (v === "enum") { this.next(); base = this.enumSpec(); any = true; continue; }
      else {
        const s = this.lookup(v);
        if (s?.kind === "typedef" && !base && nVoid + nChar + nShort + nInt + nLong + nSigned + nUnsigned === 0) { base = s.type; }
        else break;
      }
      any = true;
      this.next();
    }
    if (!any) return null;
    const nBasic = nVoid + nChar + nShort + nInt + nLong + nSigned + nUnsigned;
    let t: Type;
    if (base) {
      if (nBasic) this.err(startPos, "combinación de tipos no válida");
      t = base;
    } else if (nVoid) {
      if (nBasic > 1) this.err(startPos, "combinación de tipos no válida");
      t = T_VOID;
    } else if (nChar) {
      if (nShort || nInt || nLong || nChar > 1 || (nSigned && nUnsigned)) this.err(startPos, "combinación de tipos no válida");
      t = nSigned ? T_SCHAR : T_CHAR;
    } else {
      if (nLong) this.err(startPos, "'long' no está soportado (los enteros son de 16 bits)");
      if (nSigned && nUnsigned) this.err(startPos, "'signed' y 'unsigned' juntos");
      if (nBasic === 0) this.warn(startPos, "falta el tipo: se supone int");
      t = nUnsigned ? T_UINT : T_INT;
    }
    if (isConst) t = withConst(t);
    return { t, storage, naked };
  }

  private structSpec(kw: Token): Type {
    if (kw.v === "union") this.err(this.pos(kw), "'union' no está soportado");
    let tag = "";
    const tpos = this.pos();
    if (this.peek().k === "id") tag = this.next().v;
    if (this.is("{")) {
      let s: StructInfo | undefined;
      const cur = tag ? this.tags[this.tags.length - 1]!.get(tag) : undefined;
      if (cur?.kind === "struct" && !cur.s.complete) s = cur.s;
      else {
        if (cur) this.err(tpos, `struct '${tag}' redefinido`);
        s = { tag, fields: [], size: 0, complete: false, pos: tpos };
        if (tag) this.tags[this.tags.length - 1]!.set(tag, { kind: "struct", s });
      }
      this.next();
      let off = 0;
      while (!this.accept("}")) {
        if (this.peek().k === "eof") throw new CErr(this.pos(), "struct sin cerrar");
        const sp = this.specs();
        if (!sp) throw new CErr(this.pos(), `se esperaba un campo y hay '${this.peek().v}'`);
        if (sp.storage) this.err(tpos, `'${sp.storage}' no vale en un campo`);
        do {
          const d = this.declarator(false);
          if (this.is(":")) { this.err(this.pos(), "los campos de bits no están soportados"); this.next(); this.constExpr(); }
          const ft = d.wrap(sp.t);
          if (!d.name) { this.err(d.pos, "campo sin nombre"); continue; }
          if (ft.k === "func" || ft.k === "void" || (ft.k === "struct" && !ft.s.complete) || (ft.k === "array" && ft.n === undefined)) {
            this.err(d.pos, `el campo '${d.name}' tiene un tipo incompleto`);
            continue;
          }
          if (s.fields.some((f) => f.name === d.name)) this.err(d.pos, `campo '${d.name}' repetido`);
          s.fields.push({ name: d.name, type: ft, off });
          off += sizeOf(ft);
        } while (this.accept(","));
        this.expect(";");
      }
      s.size = off;
      s.complete = true;
      return { k: "struct", s };
    }
    if (!tag) throw new CErr(tpos, "struct sin nombre ni cuerpo");
    const found = this.lookupTag(tag);
    if (found?.kind === "struct") {
      // "struct S;" a secas en un ámbito interior declara uno nuevo (C99 6.7.2.3); no se distingue aquí.
      return { k: "struct", s: found.s };
    }
    const s: StructInfo = { tag, fields: [], size: 0, complete: false, pos: tpos };
    this.tags[this.tags.length - 1]!.set(tag, { kind: "struct", s });
    return { k: "struct", s };
  }

  private enumSpec(): Type {
    if (this.peek().k === "id") {
      const tag = this.next().v;
      if (!this.is("{")) {
        if (!this.lookupTag(tag)) this.tags[this.tags.length - 1]!.set(tag, { kind: "enum" });
        return T_INT;
      }
      this.tags[this.tags.length - 1]!.set(tag, { kind: "enum" });
    }
    this.expect("{");
    let v = 0;
    while (!this.accept("}")) {
      const nt = this.next();
      if (nt.k !== "id") throw new CErr(this.pos(nt), "se esperaba el nombre de una constante del enum");
      if (this.accept("=")) v = this.constExpr();
      if (v < -32768 || v > 65535) this.err(this.pos(nt), `valor de enum fuera de 16 bits: ${v}`);
      this.declare(nt.v, { kind: "enum", value: norm(v, T_INT) }, this.pos(nt));
      v = norm(v, T_INT) + 1;
      if (!this.accept(",")) { this.expect("}"); break; }
    }
    return T_INT;
  }

  /**
   * Declarador (con o sin nombre). Devuelve `wrap`, que aplica punteros, arrays y
   * parámetros sobre el tipo base en el orden de C.
   */
  private declarator(abstract: boolean): { name?: string; pos: Pos; wrap: (t: Type) => Type; params?: { name?: string; type: Type; pos: Pos }[] } {
    const pos = this.pos();
    const ptrs: boolean[] = [];
    while (this.accept("*")) {
      let c = false;
      while (this.is("const") || this.is("volatile")) { if (this.next().v === "const") c = true; }
      ptrs.push(c);
    }
    let inner: ReturnType<Parser["declarator"]> | undefined;
    let name: string | undefined;
    let npos = this.pos();
    if (this.is("(") && (this.is("*", 1) || (this.peek(1).k === "id" && !this.isTypeStart(this.peek(1)) && !abstract))) {
      this.next();
      inner = this.declarator(abstract);
      this.expect(")");
    } else if (this.peek().k === "id" && !TYPE_KW.has(this.peek().v) && !(abstract && this.isTypeStart())) {
      npos = this.pos();
      name = this.next().v;
    }
    const suffixes: ({ k: "a"; n: number | undefined; pos: Pos } | { k: "f"; params: { name?: string; type: Type; pos: Pos }[] | undefined; variadic: boolean })[] = [];
    let firstParams: { name?: string; type: Type; pos: Pos }[] | undefined;
    for (;;) {
      if (this.is("[")) {
        const apos = this.pos();
        this.next();
        let n: number | undefined;
        if (!this.is("]")) {
          n = this.constExpr();
          if (n <= 0) { this.err(apos, n === 0 ? "array de tamaño 0" : "tamaño de array negativo"); n = 1; }
        }
        this.expect("]");
        suffixes.push({ k: "a", n, pos: apos });
      } else if (this.is("(")) {
        this.next();
        const pr = this.paramList();
        if (!firstParams && !inner) firstParams = pr.params;
        suffixes.push({ k: "f", params: pr.params, variadic: pr.variadic });
      } else break;
    }
    const wrap = (t: Type): Type => {
      for (const c of ptrs) t = { k: "ptr", to: t, ...(c ? { c: true } : {}) };
      for (let i = suffixes.length - 1; i >= 0; i--) {
        const s = suffixes[i]!;
        if (s.k === "a") {
          if (t.k === "func") this.err(s.pos, "array de funciones");
          if (t.k === "void") this.err(s.pos, "array de void");
          if (t.k === "array" && t.n === undefined) this.err(s.pos, "solo la primera dimensión de un array puede omitirse");
          t = { k: "array", of: t, n: s.n };
        } else {
          t = { k: "func", ret: t, params: s.params?.map((p) => p.type), variadic: s.variadic };
        }
      }
      if (inner) {
        t = inner.wrap(t);
        if (t.k === "ptr" && t.to.k === "func") this.err(inner.pos, "los punteros a función no están soportados (v1)");
      }
      return t;
    };
    return { name: inner ? inner.name : name, pos: inner ? inner.pos : npos, wrap, params: inner ? inner.params : firstParams };
  }

  private paramList(): { params: { name?: string; type: Type; pos: Pos }[] | undefined; variadic: boolean } {
    if (this.accept(")")) return { params: undefined, variadic: false };
    if (this.is("void") && this.is(")", 1)) { this.next(); this.next(); return { params: [], variadic: false }; }
    const params: { name?: string; type: Type; pos: Pos }[] = [];
    let variadic = false;
    for (;;) {
      if (this.accept("...")) { variadic = true; if (params.length === 0) this.err(this.pos(), "'...' necesita al menos un parámetro fijo"); break; }
      const ppos = this.pos();
      const sp = this.specs();
      if (!sp) throw new CErr(ppos, `se esperaba un parámetro y hay '${this.peek().v}'`);
      const d = this.declarator(true);
      let t = d.wrap(sp.t);
      if (t.k === "array") t = { k: "ptr", to: t.of };
      if (t.k === "func") { this.err(d.pos, "los punteros a función no están soportados (v1)"); t = T_VOIDP; }
      if (t.k === "void") { this.err(d.pos, "parámetro de tipo void"); t = T_INT; }
      if (t.k === "struct") this.err(d.pos, "pasar structs por valor no está soportado (usa un puntero)");
      params.push({ name: d.name, type: t, pos: d.name ? d.pos : ppos });
      if (!this.accept(",")) break;
    }
    this.expect(")");
    return { params, variadic };
  }

  private typeName(): Type {
    const pos = this.pos();
    const sp = this.specs();
    if (!sp) throw new CErr(pos, "se esperaba un tipo");
    if (sp.storage) this.err(pos, `'${sp.storage}' no vale aquí`);
    const d = this.declarator(true);
    if (d.name) this.err(d.pos, "nombre inesperado en un nombre de tipo");
    return d.wrap(sp.t);
  }

  // ---- funciones ------------------------------------------------------------------
  private funcBody(f: FuncInfo, params: { name?: string; type: Type; pos: Pos }[]) {
    if (f.defined) this.err(this.pos(), `función '${f.name}' definida dos veces`);
    f.defined = true;
    f.file = this.pos().file;
    if (!f.type.params) f.type = { ...f.type, params: [] };
    this.fn = f;
    this.refs = f.refs;
    this.curOff = 0;
    this.maxOff = 0;
    this.labelN = 0;
    f.labels = new Map();
    this.pushScope();
    f.params = [];
    params.forEach((p, i) => {
      if (!p.name) { this.err(p.pos, "parámetro sin nombre en una definición"); return; }
      const v: VarSym = { kind: "var", name: p.name, type: p.type, storage: "param", label: "", off: 4 + 2 * i, pos: p.pos };
      f.params!.push(v);
      this.declare(p.name, v, p.pos);
    });
    try {
      f.body = this.block(false);
    } finally {
      this.popScope();
      for (const [name, l] of f.labels) if (!l.defined && l.used) this.err(l.used, `etiqueta '${name}' usada pero no definida`);
      f.frameSize = this.maxOff;
      this.fn = null;
      this.refs = null;
    }
  }

  newLabel(): string { return `.l${++this.labelN}`; }

  // ---- sentencias ---------------------------------------------------------------------
  private block(scope = true): Stmt {
    const pos = this.pos();
    this.expect("{");
    if (scope) this.pushScope();
    const saveOff = this.curOff;
    const body: Stmt[] = [];
    try {
      while (!this.is("}")) {
        if (this.peek().k === "eof") throw new CErr(pos, "bloque '{' sin cerrar");
        try {
          if (this.isTypeStart() && !(this.peek(1).v === ":" )) this.localDecl(body);
          else body.push(this.stmt());
        } catch (e) {
          if (!(e instanceof CErr)) throw e;
          this.err(e.pos, e.message);
          this.sync();
        }
      }
      this.next();
    } finally {
      if (scope) this.popScope();
      this.curOff = saveOff;
    }
    return { k: "block", body, pos };
  }

  private allocLocal(size: number): number {
    this.curOff -= size;
    if (-this.curOff > this.maxOff) this.maxOff = -this.curOff;
    return this.curOff;
  }

  private localDecl(out: Stmt[]) {
    const spos = this.pos();
    const sp = this.specs()!;
    if (this.accept(";")) return;
    for (;;) {
      const d = this.declarator(false);
      if (!d.name) throw new CErr(d.pos, "falta el nombre en la declaración");
      const type = d.wrap(sp.t);
      if (sp.storage === "typedef") this.declare(d.name, { kind: "typedef", type }, d.pos);
      else if (type.k === "func") this.declareFunc(d.name, type, d.pos, sp.storage === "static", sp.naked);
      else if (sp.storage === "extern") {
        // Enlaza con el global del mismo nombre.
        const save = this.scopes;
        this.scopes = [this.scopes[0]!];
        try { this.globalVar(d.name, type, d.pos, "extern", false); } finally { this.scopes = save; }
        const g = this.scopes[0]!.get(d.name)!;
        this.declare(d.name, g, d.pos);
        if (g.kind === "var") this.addRef(g);
      } else if (sp.storage === "static") {
        const label = `__sl_${this.fn!.name}_${d.name}_${++this.prog.staticCount}`;
        const v: VarSym = { kind: "var", name: d.name, type, storage: "global", label, off: 0, pos: d.pos, isStatic: true, fileIdx: this.fileIdx, refs: new Set(), defined: true, inFunc: this.fn!.name, isConst: !!type.c };
        if (type.k === "void") this.err(d.pos, "variable de tipo void");
        this.declare(d.name, v, d.pos);
        if (this.accept("=")) {
          const save = this.refs;
          this.refs = v.refs!;
          v.init = this.initializer(type, d.pos);
          this.refs = save;
          if (type.k === "array" && type.n === undefined) v.type = { ...type, n: v.init.size / sizeOf(type.of) };
          for (const it of v.init.items) if (!constAddr(it.e)) this.err(it.e.pos, "el inicializador de una variable static debe ser constante");
          for (const r of v.refs!) this.addRef(r);
        }
        this.prog.globals.push(v);
        this.addRef(v);
      } else {
        let t: Type = type;
        if (t.k === "void") { this.err(d.pos, `variable '${d.name}' de tipo void`); t = T_INT; }
        if (t.k === "struct" && !t.s.complete) this.err(d.pos, `struct '${t.s.tag}' incompleto`);
        const v: VarSym = { kind: "var", name: d.name, type: t, storage: "local", label: "", off: 0, pos: d.pos };
        if (this.accept("=")) {
          // El símbolo aún no es visible en su propio inicializador... en C sí lo es (ámbito empieza tras el declarador).
          this.declare(d.name, v, d.pos);
          const init = this.initializer(t, d.pos);
          if (t.k === "array" && t.n === undefined) v.type = t = { ...t, n: init.size / sizeOf(t.of) };
          v.off = this.allocLocal(Math.max(1, sizeOf(t)));
          out.push({ k: "init", v, init, pos: d.pos });
        } else {
          if (t.k === "array" && t.n === undefined) this.err(d.pos, `array '${d.name}' sin tamaño`);
          v.off = this.allocLocal(Math.max(1, sizeOf(t)));
          this.declare(d.name, v, d.pos);
        }
      }
      if (this.accept(",")) continue;
      this.expect(";");
      return;
    }
    void spos;
  }

  private stmt(): Stmt {
    const t = this.peek();
    const pos = this.pos(t);
    if (t.k === "asm") {
      this.next();
      this.accept(";");
      for (const r of asmRefs(t.v, this.prog)) this.addRef(r);
      return { k: "asm", text: t.v, line: t.asmLine ?? t.line, pos };
    }
    if (t.k === "punc") {
      if (t.v === "{") return this.block();
      if (t.v === ";") { this.next(); return { k: "empty", pos }; }
    }
    if (t.k === "id") {
      if (this.is(":", 1) && !["default", "case"].includes(t.v)) {
        this.next(); this.next();
        const l = this.gotoLabel(t.v, pos, true);
        return { k: "block", pos, body: [{ k: "label", label: l, pos }, this.stmtOrEmpty()] };
      }
      switch (t.v) {
        case "if": {
          this.next();
          this.expect("(");
          const c = this.cond(this.expr());
          this.expect(")");
          const a = this.stmt();
          const b = this.accept("else") ? this.stmt() : undefined;
          return { k: "if", c, a, b, pos };
        }
        case "while": {
          this.next();
          this.expect("(");
          const c = this.cond(this.expr());
          this.expect(")");
          const body = this.loopBody();
          return { k: "while", c, body, pos };
        }
        case "do": {
          this.next();
          const body = this.loopBody();
          const cpos = this.pos(this.expect("while"));
          this.expect("(");
          const c = this.cond(this.expr());
          this.expect(")");
          this.expect(";");
          return { k: "do", c, body, pos, cpos };
        }
        case "for": {
          this.next();
          this.expect("(");
          this.pushScope();
          const saveOff = this.curOff;
          try {
            let init: Stmt | undefined;
            if (this.isTypeStart()) {
              const decls: Stmt[] = [];
              const ipos = this.pos();
              this.localDecl(decls);
              init = { k: "block", body: decls, pos: ipos };
            } else if (!this.accept(";")) {
              const ipos = this.pos();
              init = { k: "expr", e: this.expr(), pos: ipos };
              this.expect(";");
            }
            let c: Expr | undefined, step: Expr | undefined, cpos: Pos | undefined, spos: Pos | undefined;
            if (!this.is(";")) { cpos = this.pos(); c = this.cond(this.expr()); }
            this.expect(";");
            if (!this.is(")")) { spos = this.pos(); step = this.expr(); }
            this.expect(")");
            const body = this.loopBody();
            return { k: "for", init, c, step, body, pos, cpos, spos };
          } finally {
            this.popScope();
            this.curOff = saveOff;
          }
        }
        case "switch": {
          this.next();
          this.expect("(");
          let e = this.rv(this.expr());
          if (!isInt(e.t)) { this.err(e.pos, "switch necesita una expresión entera"); e = this.num(0, T_INT, e.pos); }
          e = this.promote(e);
          this.expect(")");
          const sw: { cases: { v: number; label: string }[]; def?: string; t: Type } = { cases: [], t: e.t };
          this.switches.push(sw);
          this.breakable++;
          try {
            const body = this.stmt();
            return { k: "switch", e, body, cases: sw.cases, def: sw.def, pos };
          } finally {
            this.switches.pop();
            this.breakable--;
          }
        }
        case "case": {
          this.next();
          const v0 = this.constExpr();
          this.expect(":");
          const sw = this.switches[this.switches.length - 1];
          if (!sw) { this.err(pos, "'case' fuera de un switch"); return this.stmtOrEmpty(); }
          const v = norm(v0, sw.t);
          if (sw.cases.some((c) => c.v === v)) this.err(pos, `case ${v0} repetido`);
          const label = this.newLabel();
          sw.cases.push({ v, label });
          return { k: "block", pos, body: [{ k: "case", label, pos }, this.stmtOrEmpty()] };
        }
        case "default": {
          this.next();
          this.expect(":");
          const sw = this.switches[this.switches.length - 1];
          if (!sw) { this.err(pos, "'default' fuera de un switch"); return this.stmtOrEmpty(); }
          if (sw.def) this.err(pos, "'default' repetido");
          const label = this.newLabel();
          sw.def = label;
          return { k: "block", pos, body: [{ k: "case", label, pos }, this.stmtOrEmpty()] };
        }
        case "break":
          this.next(); this.expect(";");
          if (!this.breakable) this.err(pos, "'break' fuera de un bucle o switch");
          return { k: "break", pos };
        case "continue":
          this.next(); this.expect(";");
          if (!this.loops) this.err(pos, "'continue' fuera de un bucle");
          return { k: "continue", pos };
        case "return": {
          this.next();
          const rt = this.fn!.type.ret;
          if (this.accept(";")) {
            if (rt.k !== "void") this.warn(pos, "'return' sin valor en una función que devuelve un valor");
            return { k: "return", pos };
          }
          let e = this.expr();
          this.expect(";");
          if (rt.k === "void") { this.err(e.pos, "'return' con valor en una función void"); return { k: "return", pos }; }
          e = this.assignConv(e, rt, "return");
          return { k: "return", e, pos };
        }
        case "goto": {
          this.next();
          const nt = this.next();
          if (nt.k !== "id") throw new CErr(this.pos(nt), "goto necesita una etiqueta");
          this.expect(";");
          return { k: "goto", label: this.gotoLabel(nt.v, this.pos(nt), false), pos };
        }
      }
    }
    const e = this.expr();
    this.expect(";");
    return { k: "expr", e, pos };
  }

  private stmtOrEmpty(): Stmt {
    if (this.is("}")) return { k: "empty", pos: this.pos() };
    if (this.isTypeStart()) {
      // C99 no permite declaración tras etiqueta, pero es inofensivo admitirlo.
      const out: Stmt[] = [];
      const pos = this.pos();
      this.localDecl(out);
      return { k: "block", body: out, pos };
    }
    return this.stmt();
  }

  private loopBody(): Stmt {
    this.breakable++; this.loops++;
    try { return this.stmt(); } finally { this.breakable--; this.loops--; }
  }

  private gotoLabel(name: string, pos: Pos, define: boolean): string {
    const m = this.fn!.labels!;
    let l = m.get(name);
    if (!l) { l = { used: null, defined: false, label: `.u_${name}` }; m.set(name, l); }
    if (define) {
      if (l.defined) this.err(pos, `etiqueta '${name}' repetida`);
      l.defined = true;
    } else if (!l.used) l.used = pos;
    return l.label;
  }

  // ---- inicializadores -----------------------------------------------------------
  private initializer(t: Type, pos: Pos): Init {
    const items: InitItem[] = [];
    let size: number;
    if (t.k === "array" || t.k === "struct") {
      if (t.k === "struct" && !t.s.complete) this.err(pos, `struct '${t.s.tag}' incompleto`);
      const n = this.initElem(t, 0, items, true);
      size = t.k === "array" && t.n === undefined ? n * sizeOf(t.of) : sizeOf(t);
    } else {
      this.initElem(t, 0, items, true);
      size = sizeOf(t);
    }
    return { items, size };
  }

  /** Inicializa un objeto de tipo t en off. Devuelve el nº de elementos (arrays). */
  private initElem(t: Type, off: number, items: InitItem[], top: boolean): number {
    if (t.k === "array" && isChar(t.of) && (this.peek().k === "str" || (this.is("{") && this.peek(1).k === "str" && this.is("}", 2)))) {
      const braced = this.accept("{");
      const st = this.stringLit();
      if (braced) this.expect("}");
      const bytes = st.bytes;
      let n = t.n;
      if (n === undefined) n = bytes.length + 1;
      if (bytes.length > n) this.err(st.pos, `cadena demasiado larga para char[${n}] (${bytes.length} caracteres)`);
      for (let i = 0; i < n && i < bytes.length + 1; i++) items.push({ off: off + i, type: t.of, e: this.num(bytes[i] ?? 0, t.of, st.pos) });
      return n;
    }
    if (t.k === "array" || t.k === "struct") {
      if (this.is("{")) {
        this.next();
        const n = this.initList(t, off, items, true);
        return n;
      }
      if (top) {
        // struct s = otra_struct; (local)
        const e = this.assignExpr();
        if (t.k === "struct" && e.t.k === "struct" && e.t.s === t.s) { items.push({ off, type: t, e }); return 1; }
        throw new CErr(e.pos, "un array o struct se inicializa con { … }");
      }
      return this.initList(t, off, items, false);
    }
    if (this.is("{")) {
      this.next();
      this.initElem(t, off, items, false);
      this.accept(",");
      this.expect("}");
      return 1;
    }
    const e = this.assignConv(this.assignExpr(), unqual(t), "inicialización");
    items.push({ off, type: t, e });
    return 1;
  }

  private initList(t: Extract<Type, { k: "array" } | { k: "struct" }>, off: number, items: InitItem[], braced: boolean): number {
    const max = t.k === "array" ? (t.n ?? Infinity) : t.s.fields.length;
    let i = 0;
    while (i < max) {
      if (i > 0) {
        if (!this.is(",")) break;
        if (this.is("}", 1)) { if (braced) this.next(); break; }
        this.next();
      }
      if (this.is("}")) break;
      const et = t.k === "array" ? t.of : t.s.fields[i]!.type;
      const eo = t.k === "array" ? off + i * sizeOf(t.of) : off + t.s.fields[i]!.off;
      this.initElem(et, eo, items, false);
      i++;
    }
    if (braced) {
      if (i >= max && this.is(",") && this.is("}", 1)) this.next();
      if (!this.is("}")) {
        this.err(this.pos(), "demasiados inicializadores");
        let depth = 0;
        while (this.peek().k !== "eof" && !(this.is("}") && depth === 0)) { if (this.is("{")) depth++; if (this.is("}")) depth--; this.next(); }
      }
      this.expect("}");
    }
    return i;
  }

  // ---- expresiones: construcción tipada ------------------------------------------
  num(v: number, t: Type, pos: Pos): Expr { return { k: "num", v: norm(v, t), t, pos }; }

  /** Conversión a rvalue: array → puntero, función → dirección, quita const. */
  rv(e: Expr): Expr {
    if (e.t.k === "array") {
      return { k: "addr", e, t: { k: "ptr", to: e.t.of }, pos: e.pos };
    }
    if (e.t.k === "func") {
      return { k: "addr", e, t: T_VOIDP, pos: e.pos };
    }
    if (e.t.c) return { ...e, t: unqual(e.t) };
    return e;
  }

  promote(e: Expr): Expr {
    if (e.t.k === "int" && e.t.size === 1) return this.cast(e, T_INT);
    return e;
  }

  cast(e: Expr, t: Type): Expr {
    t = unqual(t);
    if (t.k === "void") return { k: "cast", e, t, pos: e.pos };
    if (e.k === "num" && (t.k === "int" || t.k === "ptr")) return { k: "num", v: norm(e.v, t), t, pos: e.pos };
    if (sameType(e.t, t)) return e.t === t ? e : { ...e, t };
    return { k: "cast", e, t, pos: e.pos };
  }

  private isNullConst(e: Expr): boolean {
    return e.k === "num" && e.v === 0 && (isInt(e.t) || (e.t.k === "ptr" && e.t.to.k === "void"));
  }

  /** Conversión de asignación (C99 6.5.16.1) con avisos como gcc. */
  assignConv(e0: Expr, t: Type, what: string): Expr {
    const e = this.rv(e0);
    t = unqual(t);
    if (t.k === "struct") {
      if (e.t.k !== "struct" || e.t.s !== t.s) this.err(e.pos, `tipos incompatibles en ${what}: ${typeStr(e.t)} a ${typeStr(t)}`);
      return e;
    }
    if (t.k === "int") {
      if (e.t.k === "ptr") this.warn(e.pos, `${what}: puntero convertido a entero sin cast`);
      else if (e.t.k !== "int") this.err(e.pos, `tipos incompatibles en ${what}: ${typeStr(e.t)} a ${typeStr(t)}`);
      return this.cast(e, t);
    }
    if (t.k === "ptr") {
      if (e.t.k === "int") { if (!this.isNullConst(e)) this.warn(e.pos, `${what}: entero convertido a puntero sin cast`); }
      else if (e.t.k === "ptr") {
        const a = unqual(t.to), b = unqual(e.t.to);
        const fromFunc = e.k === "addr" && e.e.t.k === "func";
        if (!fromFunc && a.k !== "void" && b.k !== "void" && !sameType(a, b)) this.warn(e.pos, `${what}: tipos de puntero incompatibles (${typeStr(e.t)} a ${typeStr(t)})`);
        else if (e.t.to.c && !t.to.c && !fromFunc) this.warn(e.pos, `${what}: se pierde 'const'`);
      } else this.err(e.pos, `tipos incompatibles en ${what}: ${typeStr(e.t)} a ${typeStr(t)}`);
      return this.cast(e, t);
    }
    this.err(e.pos, `no se puede convertir a ${typeStr(t)}`);
    return e;
  }

  /** Condición de if/while/for/?:/&&/||/!: escalar. */
  cond(e0: Expr): Expr {
    const e = this.rv(e0);
    if (!isScalar(e.t)) this.err(e.pos, `se esperaba un valor escalar y es ${typeStr(e.t)}`);
    return e;
  }

  private lvalueCheck(e: Expr, what: string) {
    if (e.k !== "var" && e.k !== "deref") throw new CErr(e.pos, `${what} necesita un lvalue`);
    if (e.t.k === "array" || e.t.k === "func") throw new CErr(e.pos, `${what}: no se puede asignar a un ${e.t.k === "array" ? "array" : "función"}`);
    if (e.t.c) this.err(e.pos, `${what}: el objeto es const`);
    if (e.t.k === "struct" && e.t.s.fields.some((f) => f.type.c)) this.err(e.pos, `${what}: el struct tiene campos const`);
  }

  private arithType(a: Type, b: Type): Type {
    return (a.k === "int" && !a.signed && a.size === 2) || (b.k === "int" && !b.signed && b.size === 2) ? T_UINT : T_INT;
  }

  /** Operación binaria aritmética/bit a bit sobre enteros (ya con conversiones). */
  mkBin(op: BinOp, l0: Expr, r0: Expr, pos: Pos): Expr {
    let l = this.rv(l0), r = this.rv(r0);
    if (op === "+" || op === "-") {
      if (l.t.k === "ptr" || r.t.k === "ptr") return this.ptrArith(op, l, r, pos);
    }
    if (!isInt(l.t) || !isInt(r.t)) throw new CErr(pos, `operandos no válidos para '${op}' (${typeStr(l.t)} y ${typeStr(r.t)})`);
    if (op === "<<" || op === ">>") {
      l = this.promote(l);
      r = this.cast(this.promote(r), T_INT);
      return this.fold({ k: "bin", op, l, r, t: l.t, pos });
    }
    const t = this.arithType(l.t, r.t);
    return this.fold({ k: "bin", op, l: this.cast(this.promote(l), t), r: this.cast(this.promote(r), t), t, pos });
  }

  private scale(e: Expr, size: number, pos: Pos): Expr {
    e = this.cast(this.promote(e), T_INT);
    if (size === 1) return e;
    return this.fold({ k: "bin", op: "*", l: e, r: this.num(size, T_INT, pos), t: T_INT, pos });
  }

  private ptrArith(op: "+" | "-", l: Expr, r: Expr, pos: Pos): Expr {
    if (l.t.k === "ptr" && r.t.k === "ptr") {
      if (op === "+") throw new CErr(pos, "no se pueden sumar dos punteros");
      if (!sameType(unqual(l.t.to), unqual(r.t.to))) this.err(pos, "resta de punteros de tipos distintos");
      const sz = sizeOf(l.t.to);
      const diff: Expr = this.fold({ k: "bin", op: "-", l: this.cast(l, T_INT), r: this.cast(r, T_INT), t: T_INT, pos });
      if (sz === 1) return diff;
      // La diferencia es múltiplo exacto del tamaño: con potencia de 2 basta >> aritmético.
      if ((sz & (sz - 1)) === 0) return this.fold({ k: "bin", op: ">>", l: diff, r: this.num(Math.log2(sz), T_INT, pos), t: T_INT, pos });
      return this.fold({ k: "bin", op: "/", l: diff, r: this.num(sz, T_INT, pos), t: T_INT, pos });
    }
    if (r.t.k === "ptr") { if (op === "-") throw new CErr(pos, "entero menos puntero"); [l, r] = [r, l]; }
    if (!isInt(r.t)) throw new CErr(pos, `operando no válido en aritmética de punteros (${typeStr(r.t)})`);
    const pt = l.t as Extract<Type, { k: "ptr" }>;
    if (pt.to.k === "struct" && !pt.to.s.complete) this.err(pos, "aritmética con puntero a struct incompleto");
    return this.fold({ k: "bin", op, l, r: this.scale(r, sizeOf(pt.to), pos), t: l.t, pos });
  }

  mkCmp(op: CmpOp, l0: Expr, r0: Expr, pos: Pos): Expr {
    let l = this.rv(l0), r = this.rv(r0);
    let signed: boolean;
    if (l.t.k === "ptr" || r.t.k === "ptr") {
      if (l.t.k === "ptr" && r.t.k === "ptr") {
        const a = unqual(l.t.to), b = unqual(r.t.to);
        if (a.k !== "void" && b.k !== "void" && !sameType(a, b)) this.warn(pos, "comparación de punteros de tipos distintos");
      } else {
        const ie = l.t.k === "ptr" ? r : l;
        if (!isInt(ie.t)) throw new CErr(pos, `operandos no válidos para '${op}'`);
        if (!this.isNullConst(ie)) this.warn(pos, "comparación entre puntero y entero");
      }
      signed = false;
      l = this.cast(l, T_UINT); r = this.cast(r, T_UINT);
    } else {
      if (!isInt(l.t) || !isInt(r.t)) throw new CErr(pos, `operandos no válidos para '${op}' (${typeStr(l.t)} y ${typeStr(r.t)})`);
      const t = this.arithType(l.t, r.t);
      signed = t === T_INT;
      if (!signed && op !== "==" && op !== "!=") {
        const neg = (e: Expr) => e.t.k === "int" && e.t.signed && !(e.k === "num" && e.v >= 0);
        if ((neg(l) && !(r.t.k === "int" && r.t.signed)) || (neg(r) && !(l.t.k === "int" && l.t.signed))) this.warn(pos, "comparación entre con signo y sin signo");
      }
      l = this.cast(this.promote(l), t); r = this.cast(this.promote(r), t);
    }
    return this.fold({ k: "cmp", op, l, r, signed, t: T_INT, pos });
  }

  private mkNot(e0: Expr, pos: Pos): Expr {
    const e = this.cond(e0);
    return this.mkCmp("==", e, this.num(0, isPtr(e.t) ? T_UINT : T_INT, pos), pos);
  }

  /** Plegado de constantes con la aritmética exacta de 16 bits. */
  fold(e: Expr): Expr {
    if (e.k === "bin" && e.l.k === "num" && e.r.k === "num") {
      const t = e.t;
      const uns = t.k === "ptr" || (t.k === "int" && !t.signed);
      const a = uns ? e.l.v & 0xffff : e.l.v, b = uns ? e.r.v & 0xffff : e.r.v;
      let v: number;
      switch (e.op) {
        case "+": v = a + b; break;
        case "-": v = a - b; break;
        case "*": v = Math.imul(a, b); break;
        case "/": if (b === 0) { this.warn(e.pos, "división por cero"); return e; } v = Math.trunc(a / b); break;
        case "%": if (b === 0) { this.warn(e.pos, "división por cero"); return e; } v = a % b; break;
        case "<<": v = b >= 16 || b < 0 ? 0 : a << b; break;
        case ">>": v = b >= 16 || b < 0 ? (a < 0 ? -1 : 0) : uns ? (a & 0xffff) >>> b : a >> b; break;
        case "&": v = a & b; break;
        case "|": v = a | b; break;
        case "^": v = a ^ b; break;
      }
      return { k: "num", v: norm(v, t), t, pos: e.pos };
    }
    if (e.k === "cmp" && e.l.k === "num" && e.r.k === "num") {
      const a = e.signed ? e.l.v : e.l.v & 0xffff, b = e.signed ? e.r.v : e.r.v & 0xffff;
      const r = { "==": a === b, "!=": a !== b, "<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b }[e.op];
      return { k: "num", v: r ? 1 : 0, t: T_INT, pos: e.pos };
    }
    // x + 0, x * 1: sin código.
    if (e.k === "bin" && e.r.k === "num") {
      const rv = e.r.v;
      if ((rv === 0 && (e.op === "+" || e.op === "-" || e.op === "|" || e.op === "^" || e.op === "<<" || e.op === ">>")) || (rv === 1 && (e.op === "*" || e.op === "/"))) {
        return e.l.t === e.t || sameType(e.l.t, e.t) ? e.l : { ...e.l, t: e.t } as Expr;
      }
      // (p + a) + b → p + (a+b) para los offsets de campos y arrays.
      if ((e.op === "+" || e.op === "-") && e.l.k === "bin" && (e.l.op === "+" || e.l.op === "-") && e.l.r.k === "num" && (e.t.k === "ptr" ? e.l.t.k === "ptr" : sameType(e.l.t, e.t))) {
        const off = (e.l.op === "+" ? e.l.r.v : -e.l.r.v) + (e.op === "+" ? rv : -rv);
        const rt = e.l.r.t;
        return { k: "bin", op: "+", l: e.l.l, r: { k: "num", v: norm(off, rt), t: rt, pos: e.r.pos }, t: e.t, pos: e.pos };
      }
    }
    return e;
  }

  private deref(e0: Expr, pos: Pos): Expr {
    const e = this.rv(e0);
    if (e.t.k !== "ptr") throw new CErr(pos, `no se puede desreferenciar un ${typeStr(e.t)}`);
    const to = e.t.to;
    if (to.k === "void") throw new CErr(pos, "desreferencia de void *");
    if (e.k === "addr" && sameType(e.e.t, to) && !!e.e.t.c === !!to.c) return e.e;
    return { k: "deref", e, t: to, pos };
  }

  private addrOf(e: Expr, pos: Pos): Expr {
    if (e.k === "deref") return { ...e.e, t: { k: "ptr", to: e.t }, pos } as Expr;
    if (e.k === "var") return { k: "addr", e, t: { k: "ptr", to: e.t }, pos };
    if (e.k === "faddr") return { k: "addr", e, t: T_VOIDP, pos };
    throw new CErr(pos, "'&' necesita un lvalue");
  }

  private member(base: Expr, name: string, pos: Pos, arrow: boolean): Expr {
    let addr: Expr;
    let st: Type;
    if (arrow) {
      const b = this.rv(base);
      if (b.t.k !== "ptr" || b.t.to.k !== "struct") throw new CErr(pos, `'->' sobre algo que no es puntero a struct (${typeStr(b.t)})`);
      addr = b; st = b.t.to;
    } else {
      if (base.t.k !== "struct") throw new CErr(pos, `'.' sobre algo que no es un struct (${typeStr(base.t)})`);
      addr = this.addrOf(base, pos); st = base.t;
    }
    const s = (st as Extract<Type, { k: "struct" }>).s;
    if (!s.complete) throw new CErr(pos, `struct '${s.tag}' incompleto`);
    const f = s.fields.find((x) => x.name === name);
    if (!f) throw new CErr(pos, `struct '${s.tag || "<anónimo>"}' no tiene el campo '${name}'`);
    const ft = st.c ? withConst(f.type) : f.type;
    const p: Expr = this.fold({ k: "bin", op: "+", l: { ...addr, t: { k: "ptr", to: ft } } as Expr, r: this.num(f.off, T_INT, pos), t: { k: "ptr", to: ft }, pos });
    return { k: "deref", e: p, t: ft, pos };
  }

  // ---- expresiones: gramática ---------------------------------------------------------
  expr(): Expr {
    let e = this.assignExpr();
    while (this.is(",")) {
      const pos = this.pos(this.next());
      const r = this.rv(this.assignExpr());
      e = { k: "comma", l: e, r, t: r.t, pos };
    }
    return e;
  }

  private static ASSIGN_OPS: Record<string, BinOp | undefined> = { "=": undefined, "+=": "+", "-=": "-", "*=": "*", "/=": "/", "%=": "%", "<<=": "<<", ">>=": ">>", "&=": "&", "|=": "|", "^=": "^" };

  assignExpr(): Expr {
    const l = this.condExpr();
    const t = this.peek();
    if (t.k === "punc" && t.v in Parser.ASSIGN_OPS) {
      const pos = this.pos(this.next());
      const op = Parser.ASSIGN_OPS[t.v];
      this.lvalueCheck(l, `'${t.v}'`);
      const r0 = this.assignExpr();
      const lt = unqual(l.t);
      if (!op) {
        const r = this.assignConv(r0, lt, "asignación");
        return { k: "assign", l, r, t: lt, pos };
      }
      // Compuesta: el tipo de la operación es el de l op r tras conversiones.
      const r = this.rv(r0);
      if (lt.k === "ptr") {
        if (op !== "+" && op !== "-") throw new CErr(pos, `'${t.v}' no vale con punteros`);
        if (!isInt(r.t)) throw new CErr(pos, `'${t.v}' necesita un entero`);
        return { k: "assign", op, opT: lt, l, r: this.scale(r, sizeOf(lt.to), pos), t: lt, pos };
      }
      if (!isInt(lt) || !isInt(r.t)) throw new CErr(pos, `operandos no válidos para '${t.v}'`);
      const opT = op === "<<" || op === ">>" ? (lt.size === 1 ? T_INT : lt) : this.arithType(lt, r.t);
      const rc = op === "<<" || op === ">>" ? this.cast(this.promote(r), T_INT) : this.cast(this.promote(r), opT);
      if ((op === "/" || op === "%") && rc.k === "num" && rc.v === 0) this.warn(pos, "división por cero");
      return { k: "assign", op, opT, l, r: rc, t: lt, pos };
    }
    return l;
  }

  private condExpr(): Expr {
    const c = this.binExpr(1);
    if (!this.is("?")) return c;
    const pos = this.pos(this.next());
    const cc = this.cond(c);
    let a = this.rv(this.expr());
    this.expect(":");
    let b = this.rv(this.condExpr());
    let t: Type;
    if (isInt(a.t) && isInt(b.t)) {
      t = this.arithType(a.t, b.t);
      a = this.cast(this.promote(a), t); b = this.cast(this.promote(b), t);
    } else if (a.t.k === "ptr" && b.t.k === "ptr") {
      t = a.t.to.k === "void" ? b.t : a.t;
    } else if (a.t.k === "ptr" && this.isNullConst(b)) { t = a.t; b = this.cast(b, t); }
    else if (b.t.k === "ptr" && this.isNullConst(a)) { t = b.t; a = this.cast(a, t); }
    else if (a.t.k === "void" && b.t.k === "void") t = T_VOID;
    else if (a.t.k === "struct" && b.t.k === "struct" && a.t.s === b.t.s) throw new CErr(pos, "?: con structs no está soportado");
    else throw new CErr(pos, `tipos incompatibles en ?: (${typeStr(a.t)} y ${typeStr(b.t)})`);
    if (cc.k === "num") return cc.v ? a : b;
    return { k: "cond", c: cc, a, b, t, pos };
  }

  private static PREC: Record<string, number> = {
    "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6, "<": 7, ">": 7, "<=": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10,
  };

  private binExpr(minPrec: number): Expr {
    let l = this.castExpr();
    for (;;) {
      const t = this.peek();
      const prec = t.k === "punc" ? Parser.PREC[t.v] : undefined;
      if (prec === undefined || prec < minPrec) return l;
      const pos = this.pos(this.next());
      const r = this.binExpr(prec + 1);
      const op = t.v;
      if (op === "&&" || op === "||") {
        const a = this.cond(l), b = this.cond(r);
        if (a.k === "num") {
          // 0 && x = 0; 1 || x = 1; si no, el resultado es !!b.
          if ((op === "&&") === (a.v === 0)) l = this.num(op === "&&" ? 0 : 1, T_INT, pos);
          else l = b.k === "num" ? this.num(b.v ? 1 : 0, T_INT, pos) : this.mkCmp("!=", b, this.num(0, isPtr(b.t) ? T_UINT : T_INT, pos), pos);
        } else l = { k: op === "&&" ? "land" : "lor", l: a, r: b, t: T_INT, pos };
      } else if (op === "==" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=") l = this.mkCmp(op, l, r, pos);
      else {
        if ((op === "/" || op === "%") && r.k === "num" && r.v === 0) this.warn(pos, "división por cero");
        l = this.mkBin(op as BinOp, l, r, pos);
      }
    }
  }

  private castExpr(): Expr {
    if (this.is("(") && this.isTypeStart(this.peek(1))) {
      const pos = this.pos(this.next());
      const t = this.typeName();
      this.expect(")");
      if (this.is("{")) throw new CErr(this.pos(), "los literales compuestos no están soportados");
      const e = this.rv(this.castExpr());
      if (t.k === "void") return { k: "cast", e, t: T_VOID, pos };
      if (!isScalar(t)) throw new CErr(pos, `cast a un tipo no escalar (${typeStr(t)})`);
      if (!isScalar(e.t)) throw new CErr(pos, `cast de un valor no escalar (${typeStr(e.t)})`);
      const r = this.cast(e, t);
      return r === e ? { ...e, t: unqual(t), pos } as Expr : { ...r, pos } as Expr;
    }
    return this.unary();
  }

  private unary(): Expr {
    const t = this.peek();
    if (t.k === "punc") {
      const pos = this.pos(t);
      switch (t.v) {
        case "++": case "--": {
          this.next();
          const l = this.unary();
          return this.incdec(l, t.v === "++" ? 1 : -1, false, pos);
        }
        case "&": {
          this.next();
          const e = this.castExpr();
          if (e.k === "var") this.addRef(e.sym);
          return this.addrOf(e, pos);
        }
        case "*": { this.next(); return this.deref(this.castExpr(), pos); }
        case "+": case "-": case "~": {
          this.next();
          const e = this.rv(this.castExpr());
          if (!isInt(e.t)) throw new CErr(pos, `'${t.v}' necesita un entero (${typeStr(e.t)})`);
          const p = this.promote(e);
          if (t.v === "+") return p;
          if (p.k === "num") return this.num(t.v === "-" ? -p.v : ~p.v, p.t, pos);
          return { k: "un", op: t.v as "-" | "~", e: p, t: p.t, pos };
        }
        case "!": { this.next(); return this.mkNot(this.castExpr(), pos); }
      }
    }
    if (t.k === "id" && t.v === "sizeof") {
      const pos = this.pos(this.next());
      let ty: Type;
      if (this.is("(") && this.isTypeStart(this.peek(1))) {
        this.next();
        ty = this.typeName();
        this.expect(")");
      } else {
        const save = this.refs;
        this.refs = null; // sizeof no evalúa: no cuenta como uso
        try { ty = this.unary().t; } finally { this.refs = save; }
      }
      if (ty.k === "func") this.err(pos, "sizeof de una función");
      if ((ty.k === "struct" && !ty.s.complete) || (ty.k === "array" && ty.n === undefined) || ty.k === "void") this.err(pos, `sizeof de un tipo incompleto (${typeStr(ty)})`);
      return this.num(sizeOf(ty), T_UINT, pos);
    }
    return this.postfix();
  }

  private incdec(l: Expr, dir: number, post: boolean, pos: Pos): Expr {
    this.lvalueCheck(l, dir > 0 ? "'++'" : "'--'");
    const lt = unqual(l.t);
    if (!isScalar(lt)) throw new CErr(pos, `'++'/'--' sobre ${typeStr(lt)}`);
    const delta = lt.k === "ptr" ? dir * sizeOf(lt.to) : dir;
    return { k: "incdec", post, delta, l, t: lt, pos };
  }

  private postfix(): Expr {
    let e = this.primary();
    for (;;) {
      const t = this.peek();
      if (t.k !== "punc") return e;
      const pos = this.pos(t);
      if (t.v === "[") {
        this.next();
        const i = this.expr();
        this.expect("]");
        e = this.deref(this.mkBin("+", e, i, pos), pos);
      } else if (t.v === "(") {
        this.next();
        e = this.call(e, pos);
      } else if (t.v === "." || t.v === "->") {
        this.next();
        const nt = this.next();
        if (nt.k !== "id") throw new CErr(this.pos(nt), "se esperaba el nombre de un campo");
        e = this.member(e, nt.v, this.pos(nt), t.v === "->");
      } else if (t.v === "++" || t.v === "--") {
        this.next();
        e = this.incdec(e, t.v === "++" ? 1 : -1, true, pos);
      } else return e;
    }
  }

  private call(fe: Expr, pos: Pos): Expr {
    if (fe.k !== "faddr") throw new CErr(fe.pos, "solo se pueden llamar funciones por su nombre (no hay punteros a función en v1)");
    const f = fe.f;
    const args: Expr[] = [];
    if (!this.is(")")) {
      do args.push(this.assignExpr()); while (this.accept(","));
    }
    this.expect(")");
    const ps = f.type.params;
    if (ps) {
      if (args.length < ps.length || (args.length > ps.length && !f.type.variadic)) {
        this.err(fe.pos, `'${f.name}' espera ${ps.length}${f.type.variadic ? " o más" : ""} argumentos y recibe ${args.length}`);
      }
    }
    const conv = args.map((a, i) => {
      const p = ps?.[i];
      if (p) return this.assignConv(a, p, `argumento ${i + 1} de '${f.name}'`);
      const r = this.rv(a);
      if (r.t.k === "struct") this.err(r.pos, "pasar structs por valor no está soportado (usa un puntero)");
      return this.promote(r);
    });
    this.addRef(f);
    return { k: "call", f, args: conv, t: unqual(f.type.ret), pos };
  }

  private stringLit(): { bytes: number[]; pos: Pos } {
    const t = this.next();
    const bytes = [...t.bytes!];
    while (this.peek().k === "str") bytes.push(...this.next().bytes!);
    return { bytes, pos: this.pos(t) };
  }

  private primary(): Expr {
    const t = this.peek();
    const pos = this.pos(t);
    switch (t.k) {
      case "num": {
        this.next();
        const v = t.n ?? 0;
        if (v > 65535) { this.warn(pos, `constante ${t.v} demasiado grande para 16 bits: se trunca`); }
        const isDec = !/^0[xXbB0-7]/.test(t.v) || t.v === "0";
        const ty = t.uns || v > 32767 ? T_UINT : T_INT;
        if (isDec && v > 32767 && !t.uns && v <= 65535) { /* C pediría long: no hay, se usa unsigned (como SDCC con int de 16) */ }
        return this.num(v, ty, pos);
      }
      case "chr": this.next(); return this.num(t.n ?? 0, T_INT, pos);
      case "str": {
        const s = this.stringLit();
        return { k: "str", bytes: s.bytes, t: { k: "array", of: T_CHAR, n: s.bytes.length + 1 }, pos };
      }
      case "id": {
        if (TYPE_KW.has(t.v) && t.v !== "__naked") throw new CErr(pos, `'${t.v}' inesperado`);
        this.next();
        const s = this.lookup(t.v);
        if (!s) {
          if (this.is("(")) throw new CErr(pos, `función '${t.v}' no declarada (falta el #include o el prototipo)`);
          throw new CErr(pos, `'${t.v}' no está declarado`);
        }
        switch (s.kind) {
          case "var":
            if (s.storage === "global") this.addRef(s);
            return { k: "var", sym: s, t: s.type, pos };
          case "func":
            if (!this.is("(")) this.addRef(s.f);
            return { k: "faddr", f: s.f, t: s.f.type, pos };
          case "enum": return this.num(s.value, T_INT, pos);
          case "typedef": throw new CErr(pos, `'${t.v}' es un tipo`);
        }
        break;
      }
      case "punc":
        if (t.v === "(") {
          this.next();
          const e = this.expr();
          this.expect(")");
          return e;
        }
        break;
      case "asm": throw new CErr(pos, "__asm no vale dentro de una expresión");
      case "eof": throw new CErr(pos, "fin de fichero inesperado");
    }
    throw new CErr(pos, `'${t.v}' inesperado`);
  }

  constExpr(): number {
    const e = this.condExpr();
    const r = this.rv(e);
    if (r.k !== "num") { this.err(e.pos, "se esperaba una expresión constante"); return 1; }
    return r.v;
  }
}

/**
 * Valor constante de dirección: {label?, off} si `e` es constante en tiempo de enlace
 * (número, dirección de global o función, cadena, ± constante). La cadena se marca con
 * label undefined y str.
 */
export function constAddr(e: Expr): { sym?: VarSym | FuncInfo; str?: number[]; off: number } | null {
  switch (e.k) {
    case "num": return { off: e.v };
    case "str": return { str: e.bytes, off: 0 };
    case "cast": return e.t.k === "int" && e.t.size === 1 ? (e.e.k === "num" ? { off: norm(e.e.v, e.t) } : null) : constAddr(e.e);
    case "addr":
      if (e.e.k === "var" && e.e.sym.storage === "global") return { sym: e.e.sym, off: 0 };
      if (e.e.k === "faddr") return { sym: e.e.f, off: 0 };
      if (e.e.k === "str") return { str: e.e.bytes, off: 0 };
      if (e.e.k === "deref") return constAddr(e.e.e);
      return null;
    case "bin": {
      if (e.op !== "+" && e.op !== "-") return null;
      const l = constAddr(e.l), r = constAddr(e.r);
      if (!l || !r) return null;
      if (r.sym || r.str) { if (e.op === "-" || l.sym || l.str) return null; return { ...r, off: r.off + l.off }; }
      return { ...l, off: e.op === "+" ? l.off + r.off : l.off - r.off };
    }
    default: return null;
  }
}

/** Símbolos C a los que se refiere un bloque __asm (por nombre `_x`). */
export function asmRefs(text: string, prog: Program): (VarSym | FuncInfo)[] {
  const out: (VarSym | FuncInfo)[] = [];
  const re = /\b_([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = prog.externs.get(m[1]!);
    if (s) out.push(s);
  }
  return out;
}

export { T_CHAR, T_INT, T_UINT };
