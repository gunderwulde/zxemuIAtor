// Tokenizador de BASIC del 48K: texto → bytes del programa tal como los guarda SAVE
// (líneas con palabras clave en un byte y cada literal numérico seguido de su forma de
// 5 bytes tras 0Eh). Puro (sin DOM). Cubre lo que usan los cargadores: no valida la
// sintaxis, sólo la traduce; lo que el intérprete rechazaría se verá al cargarlo.

/** Palabras clave A5h–FFh, en orden de token. */
const KEYWORDS = [
  "RND", "INKEY$", "PI", "FN", "POINT", "SCREEN$", "ATTR", "AT", "TAB", "VAL$", "CODE", "VAL", "LEN", "SIN", "COS", "TAN",
  "ASN", "ACS", "ATN", "LN", "EXP", "INT", "SQR", "SGN", "ABS", "PEEK", "IN", "USR", "STR$", "CHR$", "NOT", "BIN",
  "OR", "AND", "<=", ">=", "<>", "LINE", "THEN", "TO", "STEP", "DEF FN", "CAT", "FORMAT", "MOVE", "ERASE", "OPEN #", "CLOSE #",
  "MERGE", "VERIFY", "BEEP", "CIRCLE", "INK", "PAPER", "FLASH", "BRIGHT", "INVERSE", "OVER", "OUT", "LPRINT", "LLIST", "STOP", "READ", "DATA",
  "RESTORE", "NEW", "BORDER", "CONTINUE", "DIM", "REM", "FOR", "GO TO", "GO SUB", "INPUT", "LOAD", "LIST", "LET", "PAUSE", "NEXT", "POKE",
  "PRINT", "PLOT", "RUN", "SAVE", "RANDOMIZE", "IF", "CLS", "DRAW", "CLEAR", "RETURN", "COPY",
];
const FIRST_TOKEN = 0xa5;
const REM = 0xea;

/** Escrituras alternativas sin espacio. */
const ALIASES: Record<string, string> = { "GOTO": "GO TO", "GOSUB": "GO SUB", "DEFFN": "DEF FN" };

// Orden de prueba: las más largas primero (GO SUB antes que GO TO no importa; "<=" antes de "<").
const BY_LENGTH = [...KEYWORDS.map((k, i) => ({ text: k, token: FIRST_TOKEN + i })), ...Object.entries(ALIASES).map(([a, k]) => ({ text: a, token: FIRST_TOKEN + KEYWORDS.indexOf(k) }))]
  .sort((a, b) => b.text.length - a.text.length);

const isAlpha = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);
const isAlnum = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/** Forma de 5 bytes de un número (la de la calculadora de la ROM). */
export function numberBytes(v: number): number[] {
  if (Number.isInteger(v) && v >= -65535 && v <= 65535) {
    const w = v & 0xffff;
    return [0, v < 0 ? 0xff : 0, w & 0xff, w >> 8, 0];
  }
  if (v === 0) return [0, 0, 0, 0, 0];
  const neg = v < 0;
  let a = Math.abs(v);
  let e = Math.floor(Math.log2(a)) + 1;
  let m = a / 2 ** e;                       // [0.5, 1)
  if (m >= 1) { m /= 2; e++; }
  if (m < 0.5) { m *= 2; e--; }
  let mant = Math.round(m * 2 ** 32);       // 32 bits con el primero siempre a 1
  if (mant >= 2 ** 32) { mant = 2 ** 31; e++; }
  if (e + 128 < 1 || e + 128 > 255) throw new Error(`número fuera de rango: ${v}`);
  a = mant;
  const b = [(a / 2 ** 24) & 0xff, (a / 2 ** 16) & 0xff, (a / 2 ** 8) & 0xff, a & 0xff];
  b[0] = (b[0]! & 0x7f) | (neg ? 0x80 : 0);
  return [e + 128, ...b];
}

export interface BasicLine { num: number; body: number[] }

/** Traduce el cuerpo de una línea (sin su número). */
function tokenizeBody(src: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " ") { i++; continue; }      // el intérprete no guarda los espacios (salvo en cadenas y REM)
    if (c === '"') {                      // cadena: se copia tal cual hasta la comilla de cierre
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      for (let k = i; k <= Math.min(j, src.length - 1); k++) out.push(src.charCodeAt(k) & 0xff);
      i = j + 1;
      continue;
    }
    if (isAlpha(c)) {
      const prev = src[i - 1];
      let kw = null as { text: string; token: number } | null;
      if (!isAlnum(prev)) {
        const rest = src.slice(i).toUpperCase();
        for (const k of BY_LENGTH) {
          if (!rest.startsWith(k.text)) continue;
          const last = k.text[k.text.length - 1]!;
          // Una palabra de letras no puede ir pegada a otra letra ("LETx" no es LET x).
          if (isAlpha(last) && isAlpha(src[i + k.text.length])) continue;
          kw = k; break;
        }
      }
      if (kw) {
        out.push(kw.token);
        i += kw.text.length;
        if (kw.token === REM) { while (i < src.length) out.push(src.charCodeAt(i++) & 0xff); }
        continue;
      }
      // Nombre de variable: las cifras que lo siguen no son números.
      let j = i;
      while (j < src.length && (isAlnum(src[j]) || src[j] === "$")) j++;
      for (let k = i; k < j; k++) out.push(src.charCodeAt(k) & 0xff);
      i = j;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      for (const ch of m[0]) out.push(ch.charCodeAt(0));
      out.push(0x0e, ...numberBytes(Number(m[0])));
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    const op = two === "<=" || two === ">=" || two === "<>" ? two : null;
    if (op) { out.push(FIRST_TOKEN + KEYWORDS.indexOf(op)); i += 2; continue; }
    out.push(c.charCodeAt(0) & 0xff);
    i++;
  }
  return out;
}

export interface BasicResult { bytes: number[]; errors: { line: number; msg: string }[] }

/** Programa BASIC en texto (una línea por renglón, con su número) → bytes. */
export function tokenizeBasic(source: string): BasicResult {
  const errors: BasicResult["errors"] = [];
  const bytes: number[] = [];
  const lines: BasicLine[] = [];
  source.split(/\r?\n/).forEach((raw, idx) => {
    const t = raw.trim();
    if (t === "") return;
    const m = /^(\d+)\s*(.*)$/.exec(t);
    if (!m) { errors.push({ line: idx + 1, msg: "la línea debe empezar por su número" }); return; }
    const num = Number(m[1]);
    if (num < 1 || num > 9999) { errors.push({ line: idx + 1, msg: `número de línea fuera de 1–9999: ${num}` }); return; }
    if (lines.length && num <= lines[lines.length - 1]!.num) { errors.push({ line: idx + 1, msg: `la línea ${num} no sigue en orden creciente` }); return; }
    lines.push({ num, body: [...tokenizeBody(m[2]!), 0x0d] });
  });
  for (const l of lines) bytes.push(l.num >> 8, l.num & 0xff, l.body.length & 0xff, l.body.length >> 8, ...l.body);
  return { bytes, errors };
}
