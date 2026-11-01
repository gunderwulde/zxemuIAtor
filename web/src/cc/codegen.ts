// Generación de código Z80 (K1) directamente sobre el AST tipado. Modelo: acumulador HL
// (16 bits; los valores de 8 bits van extendidos a HL según su tipo), DE como segundo
// operando, pila para temporales e IX como puntero de marco (docs/c-abi.md §3).
//
// Invariante: tras evaluar una expresión de tipo char, HL contiene su valor ya
// extendido (cero o signo). Así las promociones a int no cuestan nada y solo las
// conversiones a char (truncar) emiten código.

import { constAddr, type Program } from "./parser";
import type { Diag } from "./preproc";
import { isChar, sizeOf, type CmpOp, type Expr, type FuncInfo, type Init, type Pos, type Stmt, type Type, type VarSym } from "./types";

type Loc = { k: "ix"; off: number } | { k: "abs"; label: string; off: number };

const hexs = (v: number) => {
  const s = v.toString(16).toUpperCase();
  return v < 256 ? String(v) : (/^[A-F]/.test(s) ? "0" : "") + s + "h";
};
const hex = (v: number) => hexs(v & 0xffff);
const hex8 = (v: number) => hexs(v & 0xff);
const ixo = (o: number) => (o < 0 ? `(ix-${-o})` : `(ix+${o})`);
const symOff = (label: string, off: number) => (label === "" ? hex(off) : off === 0 ? label : off > 0 ? `${label}+${off}` : `${label}-${-off}`);
const isPow2 = (v: number) => v > 0 && (v & (v - 1)) === 0;

/** Marcador de línea C en la salida (lo consume index.ts para el cLineMap). */
export const MARK = ";#";
/** Delimitan un bloque __asm del usuario (barrera del peephole; se quitan al final). */
export const ASM_BEGIN = ";{asm";
export const ASM_END = ";}asm";

export class CodeGen {
  out: string[] = [];
  helpers = new Set<string>();
  strings = new Map<string, string>();
  stringOrder: { label: string; bytes: number[] }[] = [];
  blobs: { label: string; init: Init; size: number }[] = [];
  private fn!: FuncInfo;
  private frame = false;
  private labelN = 0;
  private brk: string[] = [];
  private cont: string[] = [];
  private retUsed = false;
  private lastMark = "";

  constructor(private prog: Program, private diags: Diag[], private srcLine: (file: string, line: number) => string) {}

  private e(s: string) { this.out.push("        " + s); }
  private lab(l: string) { this.out.push(l + ":"); }
  private newLabel(): string { return `.c${++this.labelN}`; }
  private err(pos: Pos, msg: string) { this.diags.push({ ...pos, msg, severity: "error" }); }

  mark(pos: Pos) {
    const key = `${pos.file}:${pos.line}`;
    if (key === this.lastMark) return;
    this.lastMark = key;
    this.out.push(`${MARK}${pos.file}:${pos.line}: ${this.srcLine(pos.file, pos.line).trim()}`);
  }

  strLabel(bytes: number[]): string {
    const key = bytes.join(",");
    let l = this.strings.get(key);
    if (!l) {
      l = `__str${this.strings.size}`;
      this.strings.set(key, l);
      this.stringOrder.push({ label: l, bytes });
    }
    return l;
  }

  // ---- funciones ----------------------------------------------------------------
  genFunc(f: FuncInfo) {
    this.fn = f;
    this.labelN = 0;
    this.retUsed = false;
    this.lastMark = "";
    const size = f.frameSize ?? 0;
    this.frame = !f.naked && ((f.params?.length ?? 0) > 0 || size > 0);
    this.out.push("");
    this.out.push(`; ${f.name}: ${f.file ?? ""}:${f.pos.line}`);
    this.lab(f.label);
    this.mark(f.pos);
    if (this.frame) {
      this.e("push ix");
      this.e("ld ix,0");
      this.e("add ix,sp");
      if (size > 0 && size <= 6) {
        for (let i = 0; i < size >> 1; i++) this.e("push hl");
        if (size & 1) this.e("dec sp");
      } else if (size > 0) {
        this.e(`ld hl,${hex(-size)}`);
        this.e("add hl,sp");
        this.e("ld sp,hl");
      }
    }
    this.stmt(f.body!);
    if (f.naked) return;
    this.lastMark = "";
    if (this.retUsed) this.lab(".lret");
    // Marca de la llave de cierre: el paso a paso se para en el epílogo.
    if (this.frame) {
      if (size > 0) this.e("ld sp,ix");
      this.e("pop ix");
    }
    this.e("ret");
  }

  // ---- sentencias ------------------------------------------------------------------
  private stmt(s: Stmt) {
    switch (s.k) {
      case "block": for (const b of s.body) this.stmt(b); return;
      case "empty": return;
      case "expr": this.mark(s.pos); this.expr(s.e, true); return;
      case "init": this.mark(s.pos); this.localInit(s.v, s.init); return;
      case "if": {
        this.mark(s.pos);
        const lelse = this.newLabel();
        this.branch(s.c, lelse, false);
        this.stmt(s.a);
        if (s.b) {
          const lend = this.newLabel();
          this.e(`jp ${lend}`);
          this.lab(lelse);
          this.stmt(s.b);
          this.lab(lend);
        } else this.lab(lelse);
        this.lastMark = "";
        return;
      }
      case "while": {
        // Bucle rotado: la condición va al final y se entra saltando a ella.
        this.mark(s.pos);
        const lb = this.newLabel(), lc = this.newLabel(), le = this.newLabel();
        const always = s.c.k === "num" && s.c.v !== 0;
        if (!always) this.e(`jp ${lc}`);
        this.lab(lb);
        this.loop(le, lc, s.body);
        this.lab(lc);
        this.lastMark = "";
        this.mark(s.pos);
        if (always) this.e(`jp ${lb}`);
        else this.branch(s.c, lb, true);
        this.lab(le);
        this.lastMark = "";
        return;
      }
      case "do": {
        const lb = this.newLabel(), lc = this.newLabel(), le = this.newLabel();
        this.lab(lb);
        this.loop(le, lc, s.body);
        this.lab(lc);
        this.lastMark = "";
        this.mark(s.cpos);
        this.branch(s.c, lb, true);
        this.lab(le);
        this.lastMark = "";
        return;
      }
      case "for": {
        this.mark(s.pos);
        if (s.init) this.stmt(s.init);
        const lb = this.newLabel(), lc = this.newLabel(), ls = this.newLabel(), le = this.newLabel();
        const always = !s.c || (s.c.k === "num" && s.c.v !== 0);
        if (!always) this.e(`jp ${lc}`);
        this.lab(lb);
        this.loop(le, ls, s.body);
        this.lab(ls);
        this.lastMark = "";
        if (s.step) { this.mark(s.spos ?? s.pos); this.expr(s.step, true); }
        this.lab(lc);
        this.lastMark = "";
        if (always) this.e(`jp ${lb}`);
        else { this.mark(s.cpos ?? s.pos); this.branch(s.c!, lb, true); }
        this.lab(le);
        this.lastMark = "";
        return;
      }
      case "switch": {
        this.mark(s.pos);
        const le = this.newLabel();
        this.switchDispatch(s.e, s.cases, s.def ?? le);
        this.brk.push(le);
        try { this.stmt(s.body); } finally { this.brk.pop(); }
        this.lab(le);
        this.lastMark = "";
        return;
      }
      case "case": this.lab(s.label); this.lastMark = ""; return;
      case "label": this.lab(s.label); this.lastMark = ""; return;
      case "break": this.mark(s.pos); this.e(`jp ${this.brk[this.brk.length - 1]}`); return;
      case "continue": this.mark(s.pos); this.e(`jp ${this.cont[this.cont.length - 1]}`); return;
      case "goto": this.mark(s.pos); this.e(`jp ${s.label}`); return;
      case "return":
        this.mark(s.pos);
        if (s.e) this.expr(s.e, false);
        if (this.fn.naked) { this.e("ret"); return; }
        this.retUsed = true;
        this.e("jp .lret");
        return;
      case "asm": {
        this.asmText(s.text, s.pos.file, s.line);
        return;
      }
    }
  }

  /** Copia un bloque __asm con una marca de línea C por cada línea no vacía. */
  asmText(text: string, file: string, line: number) {
    this.out.push(ASM_BEGIN);
    text.split("\n").forEach((l, i) => {
      this.lastMark = "";
      if (l.trim() !== "") this.mark({ file, line: line + i, col: 1 });
      this.out.push(l);
    });
    this.out.push(ASM_END);
    this.lastMark = "";
  }

  private loop(brk: string, cont: string, body: Stmt) {
    this.brk.push(brk); this.cont.push(cont);
    try { this.stmt(body); } finally { this.brk.pop(); this.cont.pop(); }
  }

  private switchDispatch(e: Expr, cases: { v: number; label: string }[], def: string) {
    const inner = stripNoop(e);
    const byte = isChar(inner.t);
    const signed = inner.t.k === "int" && inner.t.signed;
    let cs = cases.slice();
    if (byte) cs = cs.filter((c) => (signed ? c.v >= -128 && c.v <= 127 : c.v >= 0 && c.v <= 255));
    cs.sort((a, b) => a.v - b.v);
    this.expr(byte ? inner : e, false);
    if (cs.length === 0) { this.e(`jp ${def}`); return; }
    const min = cs[0]!.v, max = cs[cs.length - 1]!.v;
    const range = max - min + 1;
    if (cs.length >= 4 && range <= 255 && range <= 3 * cs.length) {
      // Tabla de saltos densa.
      const tbl = this.newLabel();
      if (byte) {
        this.e("ld a,l");
        if (min !== 0) this.e(`sub ${hex8(min)}`);
        this.e(`cp ${range}`);
        this.e(`jp nc,${def}`);
        this.e("ld l,a");
        this.e("ld h,0");
      } else {
        if (min !== 0) { this.e(`ld de,${hex(-min)}`); this.e("add hl,de"); }
        this.e("ld a,h");
        this.e("or a");
        this.e(`jp nz,${def}`);
        this.e("ld a,l");
        this.e(`cp ${range}`);
        this.e(`jp nc,${def}`);
      }
      this.e("add hl,hl");
      this.e(`ld de,${tbl}`);
      this.e("add hl,de");
      this.e("ld a,(hl)");
      this.e("inc hl");
      this.e("ld h,(hl)");
      this.e("ld l,a");
      this.e("jp (hl)");
      this.lab(tbl);
      const m = new Map(cs.map((c) => [c.v, c.label]));
      for (let v = min; v <= max; v++) this.e(`dw ${m.get(v) ?? def}`);
      return;
    }
    if (byte) {
      this.e("ld a,l");
      for (const c of cs) { this.e(`cp ${hex8(c.v)}`); this.e(`jp z,${c.label}`); }
      this.e(`jp ${def}`);
      return;
    }
    // Cadena de comparaciones restando las diferencias acumuladas.
    let prev = 0;
    for (const c of cs) {
      const d = (c.v - prev) & 0xffff;
      if (d === 1) { this.e("dec hl"); this.e("ld a,h"); this.e("or l"); }
      else if (d === 0) { this.e("ld a,h"); this.e("or l"); }
      else { this.e(`ld de,${hex(d)}`); this.e("or a"); this.e("sbc hl,de"); }
      this.e(`jp z,${c.label}`);
      prev = c.v;
    }
    this.e(`jp ${def}`);
  }

  private localInit(v: VarSym, init: Init) {
    const t = v.type;
    if (t.k !== "array" && t.k !== "struct") {
      const it = init.items[0]!;
      this.expr(it.e, false);
      this.storeVar(v, 0, t);
      return;
    }
    const size = sizeOf(t);
    if (init.items.length === 1 && init.items[0]!.type.k === "struct") {
      this.addrOfLocal(v.off);
      this.e("push hl");
      this.addr(init.items[0]!.e);
      this.e("pop de");
      this.e(`ld bc,${size}`);
      this.e("ldir");
      return;
    }
    if (init.items.every((it) => constAddr(it.e))) {
      // Imagen constante en rodata y LDIR: es lo más corto para arrays y structs.
      const label = `__init${this.blobs.length}`;
      this.blobs.push({ label, init, size });
      this.addrOfLocal(v.off);
      this.e("ex de,hl");
      this.e(`ld hl,${label}`);
      this.e(`ld bc,${size}`);
      this.e("ldir");
      return;
    }
    // Valores no constantes: a cero y luego elemento a elemento.
    this.addrOfLocal(v.off);
    this.fillZero(size);
    for (const it of init.items) {
      if (it.e.k === "num" && it.e.v === 0) continue;
      this.expr(it.e, false);
      this.storeVar(v, it.off, it.type);
    }
  }

  /** Guarda HL en la local v + off (también si cae fuera del alcance de IX+d). */
  private storeVar(v: VarSym, off: number, t: Type) {
    const l = this.varLoc(v, off, sizeOf(t));
    if (l) { this.store(l, t); return; }
    this.e("push hl");
    this.addrOfLocal(v.off + off);
    this.e("pop de");
    this.e("ex de,hl");
    this.storeViaDE(t);
  }

  /** Pone a cero `size` bytes desde HL. */
  private fillZero(size: number) {
    if (size <= 4) {
      for (let i = 0; i < size; i++) { this.e("ld (hl),0"); if (i < size - 1) this.e("inc hl"); }
      return;
    }
    this.e("ld d,h");
    this.e("ld e,l");
    this.e("inc de");
    this.e(`ld bc,${size - 1}`);
    this.e("ld (hl),0");
    this.e("ldir");
  }

  private addrOfLocal(off: number) {
    this.e("push ix");
    this.e("pop hl");
    if (off !== 0) {
      if (off >= -3 && off < 0) for (let i = 0; i < -off; i++) this.e("dec hl");
      else { this.e(`ld de,${hex(off)}`); this.e("add hl,de"); }
    }
  }

  // ---- lvalues ------------------------------------------------------------------------
  private varLoc(v: VarSym, extra: number, size: number): Loc | null {
    if (v.storage === "global") return { k: "abs", label: v.label, off: extra };
    const o = v.off + extra;
    if (o < -128 || o + size - 1 > 127) return null;
    return { k: "ix", off: o };
  }

  /** Dirección directa (IX+d o absoluta) de un lvalue sin efectos laterales, si existe. */
  private loc(e: Expr): Loc | null {
    const size = e.t.k === "struct" || e.t.k === "array" ? 1 : sizeOf(e.t);
    if (e.k === "var") return this.varLoc(e.sym, 0, size);
    if (e.k === "deref") {
      const p = e.e;
      if (p.k === "num") return { k: "abs", label: "", off: p.v };
      if (p.k === "addr" && p.e.k === "var") return this.varLoc(p.e.sym, 0, size);
      if (p.k === "bin" && p.op === "+" && p.r.k === "num" && p.l.k === "addr" && p.l.e.k === "var") return this.varLoc(p.l.e.sym, p.r.v, size);
    }
    return null;
  }

  /** HL = dirección del lvalue (o de la cadena/función). */
  private addr(e: Expr) {
    switch (e.k) {
      case "var":
        if (e.sym.storage === "global") this.e(`ld hl,${e.sym.label}`);
        else this.addrOfLocal(e.sym.off);
        return;
      case "deref": this.expr(e.e, false); return;
      case "str": this.e(`ld hl,${this.strLabel(e.bytes)}`); return;
      case "faddr": this.e(`ld hl,${e.f.label}`); return;
      default: this.err(e.pos, "se esperaba un lvalue"); return;
    }
  }

  private load(l: Loc, t: Type) {
    const a = l.k === "ix" ? ixo(l.off) : "(" + symOff(l.label, l.off) + ")";
    if (sizeOf(t) === 2) {
      if (l.k === "ix") { this.e(`ld l,${a}`); this.e(`ld h,${ixo(l.off + 1)}`); }
      else this.e(`ld hl,${a}`);
      return;
    }
    const signed = t.k === "int" && t.signed;
    if (l.k === "ix") {
      if (signed) { this.e(`ld a,${a}`); this.extA(true); }
      else { this.e(`ld l,${a}`); this.e("ld h,0"); }
    } else {
      this.e(`ld a,${a}`);
      this.extA(signed);
    }
  }

  /** A = valor char (los 8 bits bajos bastan para comparar): sin pasar por HL si es un lvalue. */
  private charToA(e: Expr) {
    if (e.k === "var" || e.k === "deref") {
      const l = this.loc(e);
      if (l) this.e(`ld a,${l.k === "ix" ? ixo(l.off) : "(" + symOff(l.label, l.off) + ")"}`);
      else { this.addr(e); this.e("ld a,(hl)"); }
      return;
    }
    this.expr(e, false);
    this.e("ld a,l");
  }

  /** HL = A extendido. */
  private extA(signed: boolean) {
    this.e("ld l,a");
    if (signed) { this.e("rla"); this.e("sbc a,a"); this.e("ld h,a"); }
    else this.e("ld h,0");
  }

  private loadViaHL(t: Type) {
    if (sizeOf(t) === 2) { this.e("ld a,(hl)"); this.e("inc hl"); this.e("ld h,(hl)"); this.e("ld l,a"); }
    else if (t.k === "int" && t.signed) { this.e("ld a,(hl)"); this.extA(true); }
    else { this.e("ld l,(hl)"); this.e("ld h,0"); }
  }

  private store(l: Loc | null, t: Type) {
    if (!l) { this.err({ file: "", line: 0, col: 0 }, "interno: store sin dirección"); return; }
    if (l.k === "ix") {
      this.e(`ld ${ixo(l.off)},l`);
      if (sizeOf(t) === 2) this.e(`ld ${ixo(l.off + 1)},h`);
    } else if (sizeOf(t) === 2) this.e(`ld (${symOff(l.label, l.off)}),hl`);
    else { this.e("ld a,l"); this.e(`ld (${symOff(l.label, l.off)}),a`); }
  }

  /** (DE) = HL según el tipo; HL se conserva. */
  private storeViaDE(t: Type) {
    if (sizeOf(t) === 2) { this.e("ex de,hl"); this.e("ld (hl),e"); this.e("inc hl"); this.e("ld (hl),d"); this.e("ex de,hl"); }
    else { this.e("ld a,l"); this.e("ld (de),a"); }
  }

  // ---- expresiones -------------------------------------------------------------------
  /** ¿Se puede cargar en DE sin tocar HL? */
  private simpleDE(e0: Expr): boolean {
    const e = stripNoop(e0);
    if (e.k === "num") return true;
    if (e.k === "addr" && ((e.e.k === "var" && e.e.sym.storage === "global") || e.e.k === "str" || e.e.k === "faddr")) return true;
    if ((e.k === "var" || e.k === "deref") && e.t.k !== "struct" && e.t.k !== "array") return this.loc(e) !== null;
    return false;
  }

  /** ¿Se puede cargar en HL sin tocar DE ni BC? */
  private simpleHL(e: Expr): boolean { return this.simpleDE(e); }

  private loadDE(e0: Expr) {
    const e = stripNoop(e0);
    if (e.k === "num") { this.e(`ld de,${hex(e.v)}`); return; }
    if (e.k === "addr") {
      this.e(`ld de,${e.e.k === "var" ? e.e.sym.label : e.e.k === "faddr" ? e.e.f.label : this.strLabel((e.e as Extract<Expr, { k: "str" }>).bytes)}`);
      return;
    }
    const l = this.loc(e)!;
    const t = e.t;
    const a = l.k === "ix" ? ixo(l.off) : "(" + symOff(l.label, l.off) + ")";
    if (sizeOf(t) === 2) {
      if (l.k === "ix") { this.e(`ld e,${a}`); this.e(`ld d,${ixo(l.off + 1)}`); }
      else this.e(`ld de,${a}`);
      return;
    }
    const signed = t.k === "int" && t.signed;
    if (l.k === "ix" && !signed) { this.e(`ld e,${a}`); this.e("ld d,0"); return; }
    this.e(`ld a,${a}`);
    this.e("ld e,a");
    if (signed) { this.e("rla"); this.e("sbc a,a"); this.e("ld d,a"); }
    else this.e("ld d,0");
  }

  /** Evalúa e en HL. discard: el valor no se usa. */
  expr(e: Expr, discard: boolean): void {
    switch (e.k) {
      case "num": if (!discard) this.e(`ld hl,${hex(e.v)}`); return;
      case "str": case "faddr": this.addr(e); return;
      case "addr": if (!discard || hasSide(e.e)) this.addr(e.e); return;
      case "var": case "deref": {
        if (discard && !hasSide(e)) return;
        if (e.t.k === "struct" || e.t.k === "array") { this.addr(e); return; }
        const l = this.loc(e);
        if (l) { this.load(l, e.t); return; }
        this.addr(e);
        this.loadViaHL(e.t);
        return;
      }
      case "un":
        this.expr(e.e, discard);
        if (discard) return;
        if (e.op === "-") this.neg();
        else { this.e("ld a,l"); this.e("cpl"); this.e("ld l,a"); this.e("ld a,h"); this.e("cpl"); this.e("ld h,a"); }
        return;
      case "bin": this.bin(e, discard); return;
      case "cmp": case "land": case "lor": {
        if (discard) {
          const l = this.newLabel();
          this.branch(e, l, false);
          this.lab(l);
          return;
        }
        if (e.k === "cmp" && (e.op === "==" || e.op === "!=") && e.r.k === "num" && e.r.v === 0) {
          // !x y x != 0 sin saltos: HL = (HL == 0)
          this.expr(e.l, false);
          this.e("ld a,h");
          this.e("or l");
          this.e("ld hl,0");
          if (e.op === "==") { this.e("jr nz,$+3"); this.e("inc l"); }
          else { this.e("jr z,$+3"); this.e("inc l"); }
          return;
        }
        const lf = this.newLabel(), le = this.newLabel();
        this.branch(e, lf, false);
        this.e("ld hl,1");
        this.e(`jp ${le}`);
        this.lab(lf);
        this.e("ld hl,0");
        this.lab(le);
        return;
      }
      case "cond": {
        const lf = this.newLabel(), le = this.newLabel();
        this.branch(e.c, lf, false);
        this.expr(e.a, discard);
        this.e(`jp ${le}`);
        this.lab(lf);
        this.expr(e.b, discard);
        this.lab(le);
        return;
      }
      case "assign": this.assign(e, discard); return;
      case "incdec": this.incdec(e, discard); return;
      case "call": this.call(e); return;
      case "cast": {
        if (e.t.k === "void") { this.expr(e.e, true); return; }
        this.expr(e.e, discard);
        if (discard) return;
        this.convert(e.e.t, e.t);
        return;
      }
      case "comma": this.expr(e.l, true); this.expr(e.r, discard); return;
    }
  }

  /** Conversión del valor de HL de tipo `from` a `to` (solo cuesta truncar a char). */
  private convert(from: Type, to: Type) {
    if (to.k !== "int" || to.size !== 1) return;
    if (from.k === "int" && from.size === 1 && from.signed === to.signed) return;
    if (to.signed) { this.e("ld a,l"); this.e("rla"); this.e("sbc a,a"); this.e("ld h,a"); }
    else this.e("ld h,0");
  }

  private neg() {
    this.e("xor a"); this.e("sub l"); this.e("ld l,a"); this.e("sbc a,a"); this.e("sub h"); this.e("ld h,a");
  }

  private bin(e: Extract<Expr, { k: "bin" }>, discard: boolean) {
    if (discard && !hasSide(e)) return;
    const r = e.r;
    if (r.k === "num") {
      this.expr(e.l, false);
      this.binConst(e.op, e.t, r.v, e.l.t);
      return;
    }
    if (this.simpleDE(r)) { this.expr(e.l, false); this.loadDE(r); }
    else if (this.simpleHL(e.l)) { this.expr(r, false); this.e("ex de,hl"); this.expr(e.l, false); }
    else { this.expr(e.l, false); this.e("push hl"); this.expr(r, false); this.e("ex de,hl"); this.e("pop hl"); }
    this.binDE(e.op, e.t, e.l.t);
  }

  /** HL = HL op DE. */
  private binDE(op: string, t: Type, lt: Type) {
    const signed = t.k === "int" && t.signed;
    switch (op) {
      case "+": this.e("add hl,de"); return;
      case "-": this.e("or a"); this.e("sbc hl,de"); return;
      case "*": this.helper("__mul16"); return;
      case "/": this.helper(signed ? "__divs16" : "__divu16"); return;
      case "%": this.helper(signed ? "__mods16" : "__modu16"); return;
      case "<<": this.helper("__shl16"); return;
      case ">>": this.helper(signed ? "__shrs16" : "__shru16"); return;
      case "&": case "|": case "^": {
        const m = op === "&" ? "and" : op === "|" ? "or" : "xor";
        this.e("ld a,l"); this.e(`${m} e`); this.e("ld l,a"); this.e("ld a,h"); this.e(`${m} d`); this.e("ld h,a");
        return;
      }
    }
  }

  private helper(name: string) { this.helpers.add(name); this.e(`call ${name}`); }

  /** HL = HL op v. */
  private binConst(op: string, t: Type, v0: number, lt: Type) {
    const v = v0 & 0xffff;
    const signed = t.k === "int" && t.signed;
    switch (op) {
      case "+": case "-": {
        const d = op === "+" ? v : (-v) & 0xffff;
        if (d === 0) return;
        if (d <= 3) { for (let i = 0; i < d; i++) this.e("inc hl"); return; }
        if (d >= 0xfffd) { for (let i = 0; i < 0x10000 - d; i++) this.e("dec hl"); return; }
        if ((d & 0xff) === 0) { this.e("ld a,h"); this.e(`add a,${hex8(d >> 8)}`); this.e("ld h,a"); return; }
        this.e(`ld de,${hex(d)}`); this.e("add hl,de");
        return;
      }
      case "*": this.mulConst(v); return;
      case "/":
        if (v === 0) break;
        if (!signed && isPow2(v)) { this.shr(Math.log2(v), false); return; }
        if (signed && isPow2(v) && v < 0x8000) {
          // Truncar hacia cero: a los negativos se les suma v-1 antes de desplazar.
          const k = Math.log2(v);
          const l = this.newLabel();
          this.e("bit 7,h");
          this.e(`jr z,${l}`);
          this.e(`ld de,${hex(v - 1)}`);
          this.e("add hl,de");
          this.lab(l);
          this.shr(k, true);
          return;
        }
        break;
      case "%":
        if (!signed && isPow2(v)) { this.andConst(v - 1); return; }
        break;
      case "<<":
        if (v >= 16) { this.e("ld hl,0"); return; }
        this.shl(v);
        return;
      case ">>": {
        const sgn = signed;
        if (v >= 16) { if (sgn) { this.e("ld a,h"); this.e("rla"); this.e("sbc a,a"); this.e("ld h,a"); this.e("ld l,a"); } else this.e("ld hl,0"); return; }
        this.shr(v, sgn);
        return;
      }
      case "&": this.andConst(v); return;
      case "|": case "^": {
        const m = op === "|" ? "or" : "xor";
        for (const [r, b] of [["l", v & 0xff], ["h", v >> 8]] as const) {
          if (b === 0) continue;
          if (op === "|" && b === 0xff) { this.e(`ld ${r},255`); continue; }
          this.e(`ld a,${r}`);
          if (op === "^" && b === 0xff) this.e("cpl");
          else this.e(`${m} ${hex8(b)}`);
          this.e(`ld ${r},a`);
        }
        return;
      }
    }
    this.e(`ld de,${hex(v)}`);
    this.binDE(op, t, lt);
  }

  private andConst(v: number) {
    for (const [r, b] of [["l", v & 0xff], ["h", v >> 8]] as const) {
      if (b === 0xff) continue;
      if (b === 0) { this.e(`ld ${r},0`); continue; }
      this.e(`ld a,${r}`); this.e(`and ${hex8(b)}`); this.e(`ld ${r},a`);
    }
  }

  private shl(k: number) {
    if (k >= 8) { this.e("ld h,l"); this.e("ld l,0"); k -= 8; }
    for (let i = 0; i < k; i++) this.e("add hl,hl");
  }

  private shr(k: number, signed: boolean) {
    if (k >= 8) {
      this.e("ld l,h");
      if (signed) { this.e("ld a,h"); this.e("rla"); this.e("sbc a,a"); this.e("ld h,a"); }
      else this.e("ld h,0");
      k -= 8;
      for (let i = 0; i < k; i++) { if (signed) this.e("sra l"); else this.e("srl l"); }
      return;
    }
    for (let i = 0; i < k; i++) { this.e(signed ? "sra h" : "srl h"); this.e("rr l"); }
  }

  /** HL *= v por sumas y desplazamientos si es corto; si no, __mul16. */
  private mulConst(v: number) {
    if (v === 0) { this.e("ld hl,0"); return; }
    if (v === 1) return;
    if (isPow2(v)) { this.shl(Math.log2(v)); return; }
    const bits = v.toString(2);
    const adds = bits.length - 1 + [...bits].filter((b) => b === "1").length - 1;
    if (adds <= 8) {
      this.e("ld d,h");
      this.e("ld e,l");
      for (let i = 1; i < bits.length; i++) {
        this.e("add hl,hl");
        if (bits[i] === "1") this.e("add hl,de");
      }
      return;
    }
    this.e(`ld de,${hex(v)}`);
    this.helper("__mul16");
  }

  // ---- saltos condicionales -------------------------------------------------------------
  /** Salta a `label` si el valor de verdad de e es `when`. */
  branch(e: Expr, label: string, when: boolean): void {
    switch (e.k) {
      case "num": if ((e.v !== 0) === when) this.e(`jp ${label}`); return;
      case "land": case "lor": {
        const isAnd = e.k === "land";
        if (isAnd !== when) {
          // && saltando si falso / || saltando si cierto: cualquiera de los dos decide.
          this.branch(e.l, label, when);
          this.branch(e.r, label, when);
        } else {
          const skip = this.newLabel();
          this.branch(e.l, skip, !when);
          this.branch(e.r, label, when);
          this.lab(skip);
        }
        return;
      }
      case "cmp": this.cmpBranch(e, label, when); return;
      case "comma": this.expr(e.l, true); this.branch(e.r, label, when); return;
    }
    const inner = stripNoop(e);
    if (isChar(inner.t)) { this.charToA(inner); this.e("or a"); }
    else { this.expr(inner, false); this.e("ld a,h"); this.e("or l"); }
    this.e(`jp ${when ? "nz" : "z"},${label}`);
  }

  private cmpBranch(e: Extract<Expr, { k: "cmp" }>, label: string, when: boolean) {
    const INV: Record<CmpOp, CmpOp> = { "==": "!=", "!=": "==", "<": ">=", ">=": "<", ">": "<=", "<=": ">" };
    let op: CmpOp = when ? e.op : INV[e.op];
    let l = e.l, r = e.r;
    // Constante a la derecha.
    if (l.k === "num" && r.k !== "num") {
      const SW: Record<CmpOp, CmpOp> = { "==": "==", "!=": "!=", "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
      [l, r] = [r, l];
      op = SW[op];
    }
    const signed = e.signed;
    if (r.k === "num") {
      const v = r.v;
      const li = stripNoop(l);
      // Comparación de 8 bits si el operando es un char y la constante cabe en su rango.
      if (isChar(li.t)) {
        const ls = li.t.k === "int" && li.t.signed;
        const lo = ls ? -128 : 0, hi = ls ? 127 : 255;
        // Con la comparación sin signo de 16 bits un char con signo negativo es enorme: no se reduce.
        if (v >= lo && v <= hi && (signed || !ls)) {
          this.charToA(li);
          this.cmpA(op, v, ls, label);
          return;
        }
      }
      if (v === 0 && (op === "==" || op === "!=")) {
        this.expr(l, false);
        this.e("ld a,h"); this.e("or l");
        this.e(`jp ${op === "==" ? "z" : "nz"},${label}`);
        return;
      }
      if (v === 0 && signed && (op === "<" || op === ">=")) {
        this.expr(l, false);
        this.e("bit 7,h");
        this.e(`jp ${op === "<" ? "nz" : "z"},${label}`);
        return;
      }
      if (v === 0 && !signed) {
        if (op === "<") { this.expr(l, true); return; }
        if (op === ">=") { this.expr(l, true); this.e(`jp ${label}`); return; }
        if (op === ">" || op === "<=") {
          this.expr(l, false);
          this.e("ld a,h"); this.e("or l");
          this.e(`jp ${op === ">" ? "nz" : "z"},${label}`);
          return;
        }
      }
      // a > v  ==  a >= v+1 ;  a <= v  ==  a < v+1 (si v+1 no desborda)
      const maxv = signed ? 32767 : 65535;
      if ((op === ">" || op === "<=") && v < maxv) { op = op === ">" ? ">=" : "<"; r = { ...r, v: v + 1 }; }
      this.expr(l, false);
      if (signed && op !== "==" && op !== "!=") {
        this.e("ld a,h"); this.e("xor 80h"); this.e("ld h,a");
        this.e(`ld de,${hex((r as { v: number }).v ^ 0x8000)}`);
      } else this.e(`ld de,${hex((r as { v: number }).v)}`);
    } else {
      if (this.simpleDE(r)) { this.expr(l, false); this.loadDE(r); }
      else if (this.simpleHL(l)) { this.expr(r, false); this.e("ex de,hl"); this.expr(l, false); }
      else { this.expr(l, false); this.e("push hl"); this.expr(r, false); this.e("ex de,hl"); this.e("pop hl"); }
      if (signed && op !== "==" && op !== "!=") {
        this.e("ld a,h"); this.e("xor 80h"); this.e("ld h,a");
        this.e("ld a,d"); this.e("xor 80h"); this.e("ld d,a");
      }
    }
    // HL ? DE (sin signo tras el cambio de bit 15 si había signo).
    switch (op) {
      case "==": this.e("or a"); this.e("sbc hl,de"); this.e(`jp z,${label}`); return;
      case "!=": this.e("or a"); this.e("sbc hl,de"); this.e(`jp nz,${label}`); return;
      case "<": this.e("or a"); this.e("sbc hl,de"); this.e(`jp c,${label}`); return;
      case ">=": this.e("or a"); this.e("sbc hl,de"); this.e(`jp nc,${label}`); return;
      case ">": this.e("ex de,hl"); this.e("or a"); this.e("sbc hl,de"); this.e(`jp c,${label}`); return;
      case "<=": this.e("ex de,hl"); this.e("or a"); this.e("sbc hl,de"); this.e(`jp nc,${label}`); return;
    }
  }

  /** A ? v (8 bits) y salto. */
  private cmpA(op: CmpOp, v: number, signed: boolean, label: string) {
    let x = v & 0xff;
    if (signed && op !== "==" && op !== "!=") { this.e("xor 80h"); x ^= 0x80; }
    switch (op) {
      case "==": this.e(`cp ${hex8(x)}`); this.e(`jp z,${label}`); return;
      case "!=": this.e(`cp ${hex8(x)}`); this.e(`jp nz,${label}`); return;
      case "<": if (x === 0) return; this.e(`cp ${hex8(x)}`); this.e(`jp c,${label}`); return;
      case ">=": if (x === 0) { this.e(`jp ${label}`); return; } this.e(`cp ${hex8(x)}`); this.e(`jp nc,${label}`); return;
      case ">": if (x === 255) return; this.e(`cp ${hex8(x + 1)}`); this.e(`jp nc,${label}`); return;
      case "<=": if (x === 255) { this.e(`jp ${label}`); return; } this.e(`cp ${hex8(x + 1)}`); this.e(`jp c,${label}`); return;
    }
  }

  // ---- asignaciones ---------------------------------------------------------------------
  private assign(e: Extract<Expr, { k: "assign" }>, discard: boolean) {
    const l = e.l, t = l.t;
    if (t.k === "struct") {
      const size = sizeOf(t);
      this.addr(l);
      this.e("push hl");
      this.addr(e.r);
      this.e("pop de");
      if (!discard) this.e("push de");
      this.e(`ld bc,${size}`);
      this.e("ldir");
      if (!discard) this.e("pop hl");
      return;
    }
    const loc = this.loc(l);
    if (!e.op) {
      if (loc) { this.expr(e.r, false); this.store(loc, t); return; }
      const r = e.r;
      if (r.k === "num" && discard) {
        this.addr(l);
        this.e(`ld (hl),${hex8(r.v)}`);
        if (sizeOf(t) === 2) { this.e("inc hl"); this.e(`ld (hl),${hex8((r.v & 0xffff) >> 8)}`); }
        return;
      }
      if (this.simpleHL(r)) {
        if (l.k === "deref" && this.simpleDE(l.e)) this.loadDE(l.e);
        else { this.addr(l); this.e("ex de,hl"); }
        this.expr(r, false);
      } else {
        this.addr(l);
        this.e("push hl");
        this.expr(r, false);
        this.e("pop de");
      }
      this.storeViaDE(t);
      return;
    }
    // Compuesta.
    const opT = e.opT!;
    if (loc) {
      this.load(loc, t);
      this.opWith(e.op, opT, t, e.r);
      this.convert(opT, t);
      this.store(loc, t);
      return;
    }
    this.addr(l);
    this.e("push hl");
    this.loadViaHL(t);
    this.opWith(e.op, opT, t, e.r);
    this.convert(opT, t);
    this.e("pop de");
    this.storeViaDE(t);
  }

  /** HL = HL op r, con HL ya cargado. */
  private opWith(op: string, opT: Type, lt: Type, r: Expr) {
    if (r.k === "num") { this.binConst(op, opT, r.v, lt); return; }
    if (this.simpleDE(r)) this.loadDE(r);
    else { this.e("push hl"); this.expr(r, false); this.e("ex de,hl"); this.e("pop hl"); }
    this.binDE(op, opT, lt);
  }

  private incdec(e: Extract<Expr, { k: "incdec" }>, discard: boolean) {
    const t = e.t, d = e.delta;
    const loc = this.loc(e.l);
    if (sizeOf(t) === 1) {
      const op = d > 0 ? "inc" : "dec", undo = d > 0 ? "dec" : "inc";
      const signed = t.k === "int" && t.signed;
      if (loc?.k === "ix") {
        if (discard) { this.e(`${op} ${ixo(loc.off)}`); return; }
        this.e(`ld a,${ixo(loc.off)}`);
        this.e(`${op} a`);
        this.e(`ld ${ixo(loc.off)},a`);
        if (e.post) this.e(`${undo} a`);
        this.extA(signed);
        return;
      }
      if (loc) this.e(`ld hl,${symOff(loc.label, loc.off)}`);
      else this.addr(e.l);
      if (discard) { this.e(`${op} (hl)`); return; }
      if (e.post) { this.e("ld a,(hl)"); this.e(`${op} (hl)`); }
      else { this.e(`${op} (hl)`); this.e("ld a,(hl)"); }
      this.extA(signed);
      return;
    }
    if (loc) {
      this.load(loc, t);
      this.addConst(d);
      this.store(loc, t);
      if (e.post && !discard) this.addConst(-d);
      return;
    }
    this.addr(e.l);
    this.e("ld e,(hl)");
    this.e("inc hl");
    this.e("ld d,(hl)");
    if (d === 1) this.e("inc de");
    else if (d === -1) this.e("dec de");
    else { this.e("push hl"); this.e(`ld hl,${hex(d)}`); this.e("add hl,de"); this.e("ex de,hl"); this.e("pop hl"); }
    this.e("ld (hl),d");
    this.e("dec hl");
    this.e("ld (hl),e");
    if (discard) return;
    this.e("ex de,hl");
    if (e.post) this.addConst(-d);
  }

  private addConst(d: number) {
    d &= 0xffff;
    if (d === 0) return;
    if (d <= 3) for (let i = 0; i < d; i++) this.e("inc hl");
    else if (d >= 0xfffd) for (let i = 0; i < 0x10000 - d; i++) this.e("dec hl");
    else { this.e(`ld de,${hex(d)}`); this.e("add hl,de"); }
  }

  // ---- llamadas ---------------------------------------------------------------------------
  private call(e: Extract<Expr, { k: "call" }>) {
    for (let i = e.args.length - 1; i >= 0; i--) {
      const a = e.args[i]!;
      this.expr(a, false);
      this.e("push hl");
    }
    this.e(`call ${e.f.label}`);
    const n = e.args.length;
    if (n > 0 && n <= 4) for (let i = 0; i < n; i++) this.e("pop bc");
    else if (n > 4) { this.e("ex de,hl"); this.e(`ld hl,${2 * n}`); this.e("add hl,sp"); this.e("ld sp,hl"); this.e("ex de,hl"); }
    const rt = e.t;
    if (rt.k === "int" && rt.size === 1) {
      if (rt.signed) { this.e("ld a,l"); this.e("rla"); this.e("sbc a,a"); this.e("ld h,a"); }
      else this.e("ld h,0");
    }
  }
}

/** Quita conversiones que no cambian la representación en HL (ampliaciones y punteros). */
export function stripNoop(e: Expr): Expr {
  while (e.k === "cast" && e.t.k !== "void" && !(e.t.k === "int" && e.t.size === 1) && (e.e.t.k === "int" || e.e.t.k === "ptr")) e = e.e;
  return e;
}

export function hasSide(e: Expr): boolean {
  switch (e.k) {
    case "num": case "str": case "var": case "faddr": return false;
    case "assign": case "incdec": case "call": return true;
    case "deref": case "addr": case "un": case "cast": return hasSide(e.e);
    case "bin": case "cmp": case "land": case "lor": case "comma": return hasSide(e.l) || hasSide(e.r);
    case "cond": return hasSide(e.c) || hasSide(e.a) || hasSide(e.b);
  }
}
