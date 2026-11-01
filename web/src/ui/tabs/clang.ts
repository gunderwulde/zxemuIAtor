// U1: resaltado de C para CodeMirror 6 con un StreamLanguage propio (sin dependencias).
//
// Por qué no @codemirror/lang-cpp: añade @lezer/cpp (gramática de C++ entera, ~50 KB
// minificados) y su árbol no sabe nada de la librería del Spectrum ni de __asm. El
// subconjunto que acepta el compilador (web/src/cc) cabe en un tokenizador de línea:
// palabras clave, tipos, preprocesador, números, cadenas y caracteres, comentarios // y
// /* */ (que cruzan líneas: va en el estado), y las funciones y constantes de las
// cabeceras de la librería (sacadas de los propios .h, así no se desincronizan).
import { StreamLanguage, type StreamParser, type StringStream } from "@codemirror/language";
import { CLIB_FILES } from "../../clib";

export const C_KEYWORDS: ReadonlySet<string> = new Set([
  "auto", "break", "case", "const", "continue", "default", "do", "else", "enum", "extern",
  "for", "goto", "if", "inline", "register", "restrict", "return", "sizeof", "static",
  "struct", "switch", "typedef", "union", "volatile", "while", "__asm", "__endasm",
]);

export const C_TYPES: ReadonlySet<string> = new Set([
  "char", "short", "int", "long", "signed", "unsigned", "void", "float", "double", "_Bool",
]);

/** Funciones y macros declaradas en las cabeceras de la librería (spectrum.h, string.h…). */
function libNames(): { funcs: Set<string>; consts: Set<string> } {
  const funcs = new Set<string>(), consts = new Set<string>();
  for (const [name, text] of CLIB_FILES) {
    if (!name.endsWith(".h")) continue;
    const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ");
    for (const line of code.split("\n")) {
      const d = /^\s*#\s*define\s+([A-Za-z_]\w*)/.exec(line);
      if (d) { if (!/_H$/.test(d[1]!)) consts.add(d[1]!); continue; }
      if (/^\s*#/.test(line)) continue;
      const f = /([A-Za-z_]\w*)\s*\(/.exec(line); // primera llamada = nombre del prototipo
      if (f && !C_KEYWORDS.has(f[1]!) && !C_TYPES.has(f[1]!)) funcs.add(f[1]!);
    }
  }
  return { funcs, consts };
}
const LIB = libNames();
export const C_BUILTINS: ReadonlySet<string> = LIB.funcs;
export const C_LIB_CONSTS: ReadonlySet<string> = LIB.consts;

export interface CState {
  /** Dentro de un comentario /* … *\/ que viene de una línea anterior. */
  comment: boolean;
  /** Línea de preprocesador (sigue si acaba en \). */
  pp: boolean;
  /** La línea anterior acabó en "\" (la de preprocesador continúa). */
  cont: boolean;
  /** Tras #include: lo que va entre <> es una cadena. */
  include: boolean;
  /** Dentro de __asm … __endasm: el texto es ensamblador (no C). */
  asm: boolean;
}

const IDENT = /^[A-Za-z_]\w*/;

export const cParser: StreamParser<CState> = {
  name: "c",
  startState: () => ({ comment: false, pp: false, cont: false, include: false, asm: false }),
  copyState: (s) => ({ ...s }),
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },

  token(stream: StringStream, st: CState): string | null {
    // Una línea de preprocesador acaba en el salto de línea salvo que termine en "\".
    if (stream.sol() && st.pp && !st.cont) { st.pp = false; st.include = false; }
    const style = token(stream, st);
    if (stream.eol()) st.cont = /\\\s*$/.test(stream.string);
    return style;
  },
  blankLine(st: CState) { st.pp = false; st.include = false; st.cont = false; },
};

function token(stream: StringStream, st: CState): string | null {
  if (st.comment) {
    if (stream.match(/^.*?\*\//)) st.comment = false;
    else stream.skipToEnd();
    return "comment";
  }
  if (stream.eatSpace()) return null;
  if (st.asm) {
    if (stream.match(/^__endasm\b/)) { st.asm = false; return "keyword"; }
    if (stream.match(/^;.*/)) return "comment";
    stream.next();
    while (!stream.eol() && !stream.match(/^__endasm\b/, false) && stream.peek() !== ";") stream.next();
    return "string.special";
  }
  if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
  if (stream.match("/*")) {
    if (!stream.match(/^.*?\*\//)) { st.comment = true; stream.skipToEnd(); }
    return "comment";
  }
  // Preprocesador: "#" al principio (salvo espacios) y la directiva.
  if (stream.peek() === "#" && /^\s*$/.test(stream.string.slice(0, stream.pos))) {
    stream.next();
    stream.eatSpace();
    const d = stream.match(IDENT) as RegExpMatchArray | null;
    st.pp = true;
    st.include = d?.[0] === "include";
    return "meta";
  }
  if (st.include && stream.peek() === "<") {
    stream.match(/^<[^>\n]*>?/);
    return "string";
  }
  const ch = stream.peek()!;
  if (ch === '"' || ch === "'") {
    stream.next();
    for (;;) {
      const c = stream.next();
      if (c === undefined) return "invalid"; // sin cerrar en la línea
      if (c === "\\") { stream.next(); continue; }
      if (c === ch) return ch === '"' ? "string" : "character";
    }
  }
  // Números: decimal, 0x hex, 0 octal, 0b binario, con sufijos u/l.
  if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(stream.string.charAt(stream.pos + 1)))) {
    const n = (stream.match(/^(0[xX][0-9A-Fa-f]+|0[bB][01]+|[0-9]+(\.[0-9]*)?([eE][+-]?[0-9]+)?|\.[0-9]+)[uUlL]*/) as RegExpMatchArray | null)?.[0];
    if (!n) { stream.next(); return "invalid"; }
    if (stream.match(/^[A-Za-z0-9_]+/)) return "invalid"; // 09, 0x1G, 12abc
    return "number";
  }
  const m = stream.match(IDENT) as RegExpMatchArray | null;
  if (m) {
    const w = m[0];
    if (w === "__asm") { st.asm = true; return "keyword"; }
    if (C_KEYWORDS.has(w)) return "keyword";
    if (C_TYPES.has(w)) return "typeName";
    if (st.pp) return C_LIB_CONSTS.has(w) ? "variableName.constant" : "macroName";
    if (C_BUILTINS.has(w)) return "variableName.standard";
    if (C_LIB_CONSTS.has(w)) return "variableName.constant";
    if (/^\s*\(/.test(stream.string.slice(stream.pos))) return "variableName.function";
    return "variableName";
  }
  stream.next();
  if ("()[]{}".includes(ch)) return "bracket";
  if (ch === ";" || ch === ",") return "punctuation";
  if (ch === "\\" && st.pp) return "meta";
  return "operator";
}

export const cLanguage = StreamLanguage.define(cParser);
