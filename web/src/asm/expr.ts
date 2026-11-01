// Evaluador de expresiones: descenso recursivo directo sobre el texto (sin tokens
// intermedios). Aritmética entera de 32 bits con signo.
//
// Precedencia, de menor a mayor:
//   ||   &&   |  (OR)   ^  (XOR)   &  (AND)   == != <> = (EQ NE)
//   < <= > >= (LT LE GT GE)   << >> (SHL SHR)   + -   * / % (MOD)
//   unarios: - + ~ ! NOT HIGH LOW
// Las comparaciones y ! devuelven 1 o 0.

export interface ExprEnv {
  /** Dirección del inicio de la sentencia actual ($). */
  pc: number;
  /** Valor de un símbolo tal como está escrito (el entorno lo cualifica), o undefined. */
  lookup(name: string): number | undefined;
}

export interface ExprResult {
  value: number;
  /** false si algún símbolo no estaba definido (value no es fiable). */
  resolved: boolean;
  /** Primer símbolo indefinido y su posición en el texto. */
  undefName?: string;
  undefPos?: number;
  /** Error de sintaxis o de cálculo y su posición en el texto. */
  error?: string;
  errorPos?: number;
}

export function isIdentStart(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 46 || c === 64 || c === 63;
}

export function isIdentChar(c: number): boolean {
  return isIdentStart(c) || (c >= 48 && c <= 57);
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

function isAlnum(c: number): boolean {
  return isDigit(c) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
}

function hexVal(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}

/** Interpreta un número en radix; NaN si algún dígito no vale. */
function parseRadix(s: string, radix: number): number {
  if (s.length === 0) return NaN;
  let v = 0;
  for (let i = 0; i < s.length; i++) {
    const d = hexVal(s.charCodeAt(i));
    if (d < 0 || d >= radix) return NaN;
    v = (v * radix + d) % 4294967296;
  }
  return v | 0;
}

/**
 * Número que empieza por dígito: 255, 0FFh, 0xFF, 0b1010, 1010b, 17o/17q, 99d.
 * Los ceros a la izquierda no implican octal (010 = 10, como en M80/pasmo).
 */
export function parseNumberToken(tok: string): number {
  const t = tok.toLowerCase();
  const last = t.charCodeAt(t.length - 1);
  if (last === 104 /* h */) return parseRadix(t.slice(0, -1), 16);
  if (t.length > 2 && t[0] === "0" && t[1] === "x") return parseRadix(t.slice(2), 16);
  if (t.length > 2 && t[0] === "0" && t[1] === "b") {
    const v = parseRadix(t.slice(2), 2);
    if (!Number.isNaN(v)) return v;
  }
  if (last === 98 /* b */) return parseRadix(t.slice(0, -1), 2);
  if (last === 111 /* o */ || last === 113 /* q */) return parseRadix(t.slice(0, -1), 8);
  if (last === 100 /* d */) return parseRadix(t.slice(0, -1), 10);
  return parseRadix(t, 10);
}

export interface StringLit {
  bytes: number[];
  /** Índice tras la comilla de cierre. */
  end: number;
  error?: string;
}

/**
 * Cadena entre ' o " desde src[i]. En "..." se aceptan escapes C (\n \r \t \0 \\ \" \'
 * \a \b \e \f \v \xHH); en '...' el texto es literal y '' representa una comilla.
 */
export function parseString(src: string, i: number, end: number): StringLit {
  const q = src.charCodeAt(i);
  const bytes: number[] = [];
  let j = i + 1;
  while (j < end) {
    let c = src.charCodeAt(j);
    if (c === q) {
      if (q === 39 && j + 1 < end && src.charCodeAt(j + 1) === 39) {
        bytes.push(39);
        j += 2;
        continue;
      }
      return { bytes, end: j + 1 };
    }
    if (c === 92 /* \ */ && q === 34 && j + 1 < end) {
      j++;
      const e = src[j]!;
      switch (e) {
        case "n": c = 10; break;
        case "r": c = 13; break;
        case "t": c = 9; break;
        case "0": c = 0; break;
        case "a": c = 7; break;
        case "b": c = 8; break;
        case "e": c = 27; break;
        case "f": c = 12; break;
        case "v": c = 11; break;
        case "x": {
          const h1 = j + 1 < end ? hexVal(src.charCodeAt(j + 1)) : -1;
          if (h1 < 0) return { bytes, end: j, error: "escape \\x sin dígitos hexadecimales" };
          const h2 = j + 2 < end ? hexVal(src.charCodeAt(j + 2)) : -1;
          if (h2 >= 0) { c = h1 * 16 + h2; j += 2; } else { c = h1; j += 1; }
          break;
        }
        default: c = e.charCodeAt(0); break;
      }
    }
    bytes.push(c);
    j++;
  }
  return { bytes, end: j, error: "cadena sin cerrar" };
}

const enum Op {
  None, LOr, LAnd, Or, Xor, And, Eq, Ne, Lt, Le, Gt, Ge, Shl, Shr, Add, Sub, Mul, Div, Mod,
}

// Precedencia de cada operador binario (mayor = liga más fuerte).
const PREC: number[] = [0, 1, 2, 3, 4, 5, 6, 6, 7, 7, 7, 7, 8, 8, 9, 9, 10, 10, 10];

const WORD_OPS: Record<string, Op> = {
  or: Op.Or, xor: Op.Xor, and: Op.And, eq: Op.Eq, ne: Op.Ne, lt: Op.Lt, le: Op.Le,
  gt: Op.Gt, ge: Op.Ge, shl: Op.Shl, shr: Op.Shr, mod: Op.Mod,
};

class Parser {
  src = "";
  pos = 0;
  end = 0;
  env!: ExprEnv;
  resolved = true;
  undefName: string | undefined;
  undefPos = 0;
  error: string | undefined;
  errorPos = 0;

  fail(msg: string, pos: number): void {
    if (this.error === undefined) {
      this.error = msg;
      this.errorPos = pos;
    }
  }

  ws(): void {
    while (this.pos < this.end) {
      const c = this.src.charCodeAt(this.pos);
      if (c !== 32 && c !== 9) break;
      this.pos++;
    }
  }

  /** Lee un operador binario en la posición actual sin consumirlo; devuelve [op, longitud]. */
  peekOp(): [Op, number] {
    this.ws();
    if (this.pos >= this.end) return [Op.None, 0];
    const s = this.src, p = this.pos;
    const c = s.charCodeAt(p);
    const c2 = p + 1 < this.end ? s.charCodeAt(p + 1) : 0;
    switch (c) {
      case 43: return [Op.Add, 1];
      case 45: return [Op.Sub, 1];
      case 42: return [Op.Mul, 1];
      case 47: return [Op.Div, 1];
      case 37: return [Op.Mod, 1];
      case 94: return [Op.Xor, 1];
      case 124: return c2 === 124 ? [Op.LOr, 2] : [Op.Or, 1];
      case 38: return c2 === 38 ? [Op.LAnd, 2] : [Op.And, 1];
      case 61: return c2 === 61 ? [Op.Eq, 2] : [Op.Eq, 1];
      case 33: return c2 === 61 ? [Op.Ne, 2] : [Op.None, 0];
      case 60:
        if (c2 === 60) return [Op.Shl, 2];
        if (c2 === 61) return [Op.Le, 2];
        if (c2 === 62) return [Op.Ne, 2];
        return [Op.Lt, 1];
      case 62:
        if (c2 === 62) return [Op.Shr, 2];
        if (c2 === 61) return [Op.Ge, 2];
        return [Op.Gt, 1];
    }
    if (isIdentStart(c)) {
      let q = p;
      while (q < this.end && isIdentChar(s.charCodeAt(q))) q++;
      const w = WORD_OPS[s.slice(p, q).toLowerCase()];
      if (w !== undefined) return [w, q - p];
    }
    return [Op.None, 0];
  }

  binary(minPrec: number): number {
    let lhs = this.unary();
    for (;;) {
      const [op, len] = this.peekOp();
      if (op === Op.None) return lhs;
      const prec = PREC[op]!;
      if (prec < minPrec) return lhs;
      const opPos = this.pos;
      this.pos += len;
      const rhs = this.binary(prec + 1);
      lhs = this.apply(op, lhs, rhs, opPos);
    }
  }

  apply(op: Op, a: number, b: number, pos: number): number {
    switch (op) {
      case Op.LOr: return a !== 0 || b !== 0 ? 1 : 0;
      case Op.LAnd: return a !== 0 && b !== 0 ? 1 : 0;
      case Op.Or: return a | b;
      case Op.Xor: return a ^ b;
      case Op.And: return a & b;
      case Op.Eq: return a === b ? 1 : 0;
      case Op.Ne: return a !== b ? 1 : 0;
      case Op.Lt: return a < b ? 1 : 0;
      case Op.Le: return a <= b ? 1 : 0;
      case Op.Gt: return a > b ? 1 : 0;
      case Op.Ge: return a >= b ? 1 : 0;
      case Op.Shl: return b >= 32 || b < 0 ? 0 : (a << b) | 0;
      case Op.Shr: return b >= 32 || b < 0 ? (a < 0 ? -1 : 0) : a >> b;
      case Op.Add: return (a + b) | 0;
      case Op.Sub: return (a - b) | 0;
      case Op.Mul: return Math.imul(a, b);
      case Op.Div:
        if (b === 0) { if (this.resolved) this.fail("división por cero", pos); return 0; }
        return (a / b) | 0;
      case Op.Mod:
        if (b === 0) { if (this.resolved) this.fail("módulo por cero", pos); return 0; }
        return (a % b) | 0;
      default: return 0;
    }
  }

  unary(): number {
    this.ws();
    if (this.pos >= this.end) {
      this.fail("falta un operando", this.pos);
      return 0;
    }
    const s = this.src;
    const c = s.charCodeAt(this.pos);
    switch (c) {
      case 45: this.pos++; return -this.unary() | 0;
      case 43: this.pos++; return this.unary();
      case 126: this.pos++; return ~this.unary();
      case 33: this.pos++; return this.unary() === 0 ? 1 : 0;
      case 40: {
        const open = this.pos++;
        const v = this.binary(1);
        this.ws();
        if (this.pos < this.end && s.charCodeAt(this.pos) === 41) this.pos++;
        else this.fail("falta ')'", open);
        return v;
      }
    }
    return this.primary();
  }

  primary(): number {
    const s = this.src, start = this.pos;
    const c = s.charCodeAt(start);
    // Número decimal o con sufijo/prefijo de base.
    if (isDigit(c)) {
      let q = start;
      while (q < this.end && isAlnum(s.charCodeAt(q))) q++;
      this.pos = q;
      const v = parseNumberToken(s.slice(start, q));
      if (Number.isNaN(v)) this.fail(`número no válido '${s.slice(start, q)}'`, start);
      return Number.isNaN(v) ? 0 : v;
    }
    // #FF y $FF hexadecimales; $ solo es la dirección actual.
    if (c === 35 || c === 36) {
      let q = start + 1;
      while (q < this.end && isAlnum(s.charCodeAt(q))) q++;
      this.pos = q;
      if (q === start + 1) {
        if (c === 36) return this.env.pc;
        this.fail("'#' sin dígitos", start);
        return 0;
      }
      const v = parseRadix(s.slice(start + 1, q), 16);
      if (Number.isNaN(v)) this.fail(`número hexadecimal no válido '${s.slice(start, q)}'`, start);
      return Number.isNaN(v) ? 0 : v;
    }
    // %1010 binario (en posición de operando, % no puede ser módulo).
    if (c === 37) {
      let q = start + 1;
      while (q < this.end && isAlnum(s.charCodeAt(q))) q++;
      this.pos = q;
      const v = parseRadix(s.slice(start + 1, q), 2);
      if (Number.isNaN(v)) this.fail(`número binario no válido '${s.slice(start, q)}'`, start);
      return Number.isNaN(v) ? 0 : v;
    }
    // Carácter: 'A' o "A" (uno o dos caracteres; con dos, el primero es el byte alto).
    if (c === 39 || c === 34) {
      const lit = parseString(s, start, this.end);
      this.pos = lit.end;
      if (lit.error) { this.fail(lit.error, start); return 0; }
      if (lit.bytes.length === 0 || lit.bytes.length > 2) {
        this.fail("una constante de carácter debe tener 1 o 2 caracteres", start);
        return 0;
      }
      return lit.bytes.length === 1 ? lit.bytes[0]! & 0xff : ((lit.bytes[0]! & 0xff) << 8) | (lit.bytes[1]! & 0xff);
    }
    if (isIdentStart(c)) {
      let q = start;
      while (q < this.end && isIdentChar(s.charCodeAt(q))) q++;
      const name = s.slice(start, q);
      const lower = name.toLowerCase();
      this.pos = q;
      if (lower === "high" || lower === "low" || lower === "not") {
        // Operador unario sólo si le sigue un operando (si no, es un símbolo).
        this.ws();
        if (this.pos < this.end && this.startsOperand(s.charCodeAt(this.pos))) {
          const v = this.unary();
          if (lower === "high") return (v >> 8) & 0xff;
          if (lower === "low") return v & 0xff;
          return ~v;
        }
        this.pos = q;
      }
      const v = this.env.lookup(name);
      if (v === undefined) {
        if (this.resolved) {
          this.resolved = false;
          this.undefName = name;
          this.undefPos = start;
        }
        return 0;
      }
      return v;
    }
    this.fail(`carácter inesperado '${s[start]}'`, start);
    this.pos = this.end;
    return 0;
  }

  startsOperand(c: number): boolean {
    return c === 40 || isAlnum(c) || isIdentStart(c) || c === 35 || c === 36 || c === 37 ||
      c === 39 || c === 34 || c === 45 || c === 43 || c === 126 || c === 33;
  }
}

const parser = new Parser();

/** Evalúa src[start, end). Las posiciones del resultado son índices en src. */
export function evaluate(src: string, start: number, end: number, env: ExprEnv): ExprResult {
  const p = parser;
  p.src = src;
  p.pos = start;
  p.end = end;
  p.env = env;
  p.resolved = true;
  p.undefName = undefined;
  p.error = undefined;
  const value = p.binary(1);
  p.ws();
  if (p.pos < p.end) p.fail(`sobra texto en la expresión: '${src.slice(p.pos, end)}'`, p.pos);
  const r: ExprResult = { value, resolved: p.resolved };
  if (p.undefName !== undefined) { r.undefName = p.undefName; r.undefPos = p.undefPos; }
  if (p.error !== undefined) { r.error = p.error; r.errorPos = p.errorPos; }
  return r;
}
