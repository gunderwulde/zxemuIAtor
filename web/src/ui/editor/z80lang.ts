// Resaltado de sintaxis Z80 para CodeMirror 6 (StreamLanguage). Sigue la sintaxis del
// ensamblador (web/src/asm/README.md): una sentencia por línea,
// [etiqueta[:]] [operación [operandos]] [; comentario].
import { StreamLanguage, type StreamParser, type StringStream } from "@codemirror/language";
import { parseNumberToken } from "../../asm/expr";
import { Z80_ISA } from "../../z80isa";

/** Mnemónicos: los de la tabla ISA más los alias que acepta el ensamblador. */
export const MNEMONICS: ReadonlySet<string> = new Set([...Z80_ISA.map((e) => e.mnemonic), "sl1", "sli", "exa"]);

/** Directivas (README de A1, tabla "Directivas"), sin el punto opcional. */
export const DIRECTIVES: ReadonlySet<string> = new Set([
  "org", "equ", "defl", "db", "defb", "byte", "defm", "dm", "dz", "dc", "dw", "defw", "word",
  "ds", "defs", "block", "align", "phase", "dephase", "end", "ent", "macro", "endm", "endmacro", "local",
  "if", "ifdef", "ifndef", "ifidn", "ifdif", "else", "elseif", "endif", "include", "error",
  "rept", "dup", "repeat", "endr", "edup", "endrepeat", "aseg", "title", "subttl", "eject",
  "page", "device", "z80",
]);

export const REGISTERS: ReadonlySet<string> = new Set([
  "a", "b", "c", "d", "e", "h", "l", "f", "i", "r", "af", "bc", "de", "hl", "sp", "ix", "iy",
  "ixh", "ixl", "iyh", "iyl", "xh", "xl", "yh", "yl", "hx", "lx", "hy", "ly",
]);
const CONDITIONS = new Set(["nz", "z", "nc", "c", "po", "pe", "p", "m"]);
const COND_OPS = new Set(["jp", "jr", "call", "ret"]);
const WORD_OPERATORS = new Set(["high", "low", "mod", "and", "or", "xor", "not", "shl", "shr", "eq", "ne", "lt", "le", "gt", "ge"]);

export interface Z80State {
  /** 0 = principio de línea (puede venir etiqueta), 1 = espera operación, 2 = operandos. */
  phase: 0 | 1 | 2;
  op: string;
  /** Índice del operando actual (cuenta comas). */
  arg: number;
  /** El último token fue un valor (para distinguir % módulo de %binario). */
  value: boolean;
}

const IDENT = /^[A-Za-z_.@?][A-Za-z0-9_.@?$]*/;

function isOp(w: string): boolean {
  const l = w.toLowerCase();
  return MNEMONICS.has(l) || DIRECTIVES.has(l.startsWith(".") ? l.slice(1) : l);
}

function opStyle(w: string): string {
  const l = w.toLowerCase();
  return MNEMONICS.has(l) ? "keyword" : "meta";
}

export const z80Parser: StreamParser<Z80State> = {
  name: "z80",
  startState: () => ({ phase: 0, op: "", arg: 0, value: false }),
  copyState: (s) => ({ ...s }),
  languageData: { commentTokens: { line: ";" } },

  token(stream: StringStream, st: Z80State): string | null {
    if (stream.sol()) { st.phase = 0; st.op = ""; st.arg = 0; st.value = false; }
    const col0 = stream.pos === 0;
    if (stream.eatSpace()) { if (st.phase === 0) st.phase = 1; return null; }
    if (stream.peek() === ";") { stream.skipToEnd(); return "comment"; }

    // Identificadores: etiquetas, operaciones, registros, símbolos.
    const m = stream.match(IDENT) as RegExpMatchArray | null;
    if (m) {
      const w = m[0];
      const l = w.toLowerCase();
      if (st.phase < 2) {
        const colon = stream.peek() === ":" && stream.string[stream.pos + 1] !== "=";
        const defNext = /^\s*(equ|=|:=|defl|macro)\b|^\s*(=|:=)/i.test(stream.string.slice(stream.pos));
        if (colon || (col0 && !isOp(w)) || (st.phase === 1 && !isOp(w) && defNext)) {
          if (colon) stream.next();
          st.phase = 1;
          return "labelName";
        }
        st.phase = 2; st.op = l.startsWith(".") ? l.slice(1) : l; st.arg = 0; st.value = false;
        return isOp(w) ? opStyle(w) : "macroName";
      }
      st.value = true;
      if (l === "af" && stream.peek() === "'") { stream.next(); return "typeName"; }
      if (REGISTERS.has(l) && !(l === "c" && COND_OPS.has(st.op) && st.arg === 0)) return "typeName";
      if (CONDITIONS.has(l) && COND_OPS.has(st.op) && st.arg === 0) return "atom";
      if (WORD_OPERATORS.has(l)) { st.value = false; return "operatorKeyword"; }
      return "variableName";
    }

    const ch = stream.peek()!;
    if (st.phase < 2) { st.phase = 2; } // una operación que no empieza por letra (p. ej. "=")
    // Números que empiezan por dígito: 255, 0FFh, 0x1F, 1010b, 17o, 99d…
    if (/[0-9]/.test(ch)) {
      const n = stream.match(/^[0-9][0-9A-Za-z]*/) as RegExpMatchArray;
      st.value = true;
      return Number.isNaN(parseNumberToken(n[0])) ? "invalid" : "number";
    }
    if (ch === "$" || ch === "#") {
      stream.next();
      st.value = true;
      if (stream.match(/^[0-9A-Fa-f]+/)) return "number";
      return ch === "$" ? "atom" : "invalid"; // $ solo = dirección actual
    }
    if (ch === "%" && !st.value && stream.match(/^%[01]+/)) { st.value = true; return "number"; }
    if (ch === '"' || ch === "'") {
      stream.next();
      st.value = true;
      for (;;) {
        const c = stream.next();
        if (c === undefined) return "invalid"; // cadena sin cerrar
        if (ch === '"' && c === "\\") { stream.next(); continue; }
        if (c === ch) {
          if (ch === "'" && stream.peek() === "'") { stream.next(); continue; } // '' = comilla
          return "string";
        }
      }
    }
    stream.next();
    if (ch === ",") { st.arg++; st.value = false; return "punctuation"; }
    if (ch === "(" || ch === ")") { st.value = ch === ")"; return "paren"; }
    if (ch === ":") return "punctuation";
    st.value = false;
    return "operator";
  },
};

export const z80Language = StreamLanguage.define(z80Parser);
