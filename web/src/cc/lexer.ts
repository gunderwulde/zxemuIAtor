// Lexer de C (K1). Convierte un fichero en tokens con posición. Puro y determinista.
//
// `__asm … __endasm` se captura entero como un único token "asm" con el texto crudo
// (no se preprocesa: es ensamblador, no C).

export type TokKind = "id" | "num" | "str" | "chr" | "punc" | "asm" | "eof";

export interface Token {
  k: TokKind;
  /** Texto: identificador, puntuación o texto crudo del número. */
  v: string;
  /** num/chr: valor; str: no se usa. */
  n?: number;
  /** num: tenía sufijo U. */
  uns?: boolean;
  /** str: bytes ya sin escapes; asm: no se usa. */
  bytes?: number[];
  file: string;
  line: number;
  col: number;
  /** Primer token de su línea física (para las directivas del preprocesador). */
  bol: boolean;
  /** asm: línea del primer carácter del texto crudo. */
  asmLine?: number;
  /** Nombres de macro que ya se han expandido para producir este token (anti-recursión). */
  hide?: Set<string>;
}

export interface LexError { file: string; line: number; col: number; msg: string }

const PUNCS3 = ["<<=", ">>=", "..."];
const PUNCS2 = ["->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "*=", "/=", "%=", "+=", "-=", "&=", "^=", "|=", "##"];
const PUNCS1 = "[](){}.&*+-~!/%<>^|?:;=,#";

const isIdStart = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95;
const isDigit = (c: number) => c >= 48 && c <= 57;
const isIdChar = (c: number) => isIdStart(c) || isDigit(c);

export function lex(src: string, file: string, errors: LexError[]): Token[] {
  const out: Token[] = [];
  let i = 0, line = 1, lineStart = 0, bol = true;
  const n = src.length;
  const err = (msg: string, l = line, c = i - lineStart + 1) => errors.push({ file, line: l, col: c, msg });

  while (true) {
    // Espacios, comentarios y continuaciones de línea.
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 10) { i++; line++; lineStart = i; bol = true; }
      else if (c === 32 || c === 9 || c === 13 || c === 12 || c === 11) i++;
      else if (c === 92 && (src.charCodeAt(i + 1) === 10 || (src.charCodeAt(i + 1) === 13 && src.charCodeAt(i + 2) === 10))) {
        i += src.charCodeAt(i + 1) === 13 ? 3 : 2; line++; lineStart = i;
      } else if (c === 47 && src.charCodeAt(i + 1) === 47) {
        while (i < n && src.charCodeAt(i) !== 10) i++;
      } else if (c === 47 && src.charCodeAt(i + 1) === 42) {
        const l0 = line, c0 = i - lineStart + 1;
        i += 2;
        while (i < n && !(src.charCodeAt(i) === 42 && src.charCodeAt(i + 1) === 47)) {
          if (src.charCodeAt(i) === 10) { line++; lineStart = i + 1; }
          i++;
        }
        if (i >= n) { err("comentario /* sin cerrar", l0, c0); break; }
        i += 2;
      } else break;
    }
    const col = i - lineStart + 1;
    if (i >= n) { out.push({ k: "eof", v: "", file, line, col, bol: true }); return out; }
    const tok = (k: TokKind, v: string): Token => {
      const t: Token = { k, v, file, line, col, bol };
      bol = false;
      out.push(t);
      return t;
    };
    const c = src.charCodeAt(i);

    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdChar(src.charCodeAt(j))) j++;
      const id = src.slice(i, j);
      if (id === "__asm" || id === "_asm") {
        // Texto crudo hasta __endasm. Empieza tras __asm (puede haber código en la misma línea).
        const startLine = line;
        const t = tok("asm", "");
        let k = j;
        const m = /\b_{1,2}endasm\b/g;
        m.lastIndex = j;
        const r = m.exec(src);
        if (!r) { err("__asm sin __endasm", startLine, col); i = n; continue; }
        k = r.index;
        let text = src.slice(j, k);
        // Si el texto empieza con salto de línea, la primera línea útil es la siguiente.
        t.asmLine = startLine;
        if (text.startsWith("\r\n")) { text = text.slice(2); t.asmLine++; }
        else if (text.startsWith("\n")) { text = text.slice(1); t.asmLine++; }
        t.v = text.replace(/\r/g, "").replace(/\s*$/, "");
        for (let q = j; q < k; q++) if (src.charCodeAt(q) === 10) { line++; lineStart = q + 1; }
        i = k + r[0].length;
        continue;
      }
      tok("id", id);
      i = j;
      continue;
    }

    if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
      let j = i;
      while (j < n && (isIdChar(src.charCodeAt(j)) || src.charCodeAt(j) === 46)) j++;
      const raw = src.slice(i, j);
      const t = tok("num", raw);
      i = j;
      const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)([uUlL]*)$/.exec(raw);
      if (!m) { err(`número mal formado '${raw}'` + (/[.eE]/.test(raw) ? " (no hay coma flotante)" : ""), t.line, t.col); t.n = 0; continue; }
      const body = m[1]!, suf = m[2]!.toLowerCase();
      let v: number;
      if (/^0[xX]/.test(body)) v = parseInt(body.slice(2), 16);
      else if (/^0[bB]/.test(body)) v = parseInt(body.slice(2), 2);
      else if (body.length > 1 && body[0] === "0") {
        if (/[89]/.test(body)) { err(`dígito no octal en '${raw}'`, t.line, t.col); v = 0; }
        else v = parseInt(body, 8);
      } else v = parseInt(body, 10);
      if (suf.replace(/u/g, "").length > 0 && !/^(u?l{0,2}|l{0,2}u?)$/.test(suf)) err(`sufijo no válido en '${raw}'`, t.line, t.col);
      t.n = v;
      t.uns = suf.includes("u");
      continue;
    }

    if (c === 34 || c === 39) {
      const q = c;
      let j = i + 1;
      const bytes: number[] = [];
      let closed = false;
      while (j < n) {
        const d = src.charCodeAt(j);
        if (d === q) { closed = true; j++; break; }
        if (d === 10) break;
        if (d === 92) {
          const e = src[j + 1] ?? "";
          j += 2;
          switch (e) {
            case "n": bytes.push(10); break;
            case "t": bytes.push(9); break;
            case "r": bytes.push(13); break;
            case "a": bytes.push(7); break;
            case "b": bytes.push(8); break;
            case "f": bytes.push(12); break;
            case "v": bytes.push(11); break;
            case "e": bytes.push(27); break;
            case "\\": case "'": case "\"": case "?": bytes.push(e.charCodeAt(0)); break;
            case "x": {
              let k = j, v = 0;
              while (k < n && /[0-9a-fA-F]/.test(src[k]!)) { v = v * 16 + parseInt(src[k]!, 16); k++; }
              if (k === j) err("\\x sin dígitos", line, j - lineStart);
              j = k;
              bytes.push(v & 0xff);
              break;
            }
            default:
              if (e >= "0" && e <= "7") {
                let k = j - 1, v = 0, cnt = 0;
                while (k < n && cnt < 3 && src[k]! >= "0" && src[k]! <= "7") { v = v * 8 + (src.charCodeAt(k) - 48); k++; cnt++; }
                j = k;
                bytes.push(v & 0xff);
              } else {
                err(`escape desconocido '\\${e}'`, line, j - 1 - lineStart);
                bytes.push(e.charCodeAt(0) & 0xff);
              }
          }
          continue;
        }
        const cp = src.codePointAt(j)!;
        if (cp > 255) {
          // El Spectrum no tiene Unicode: £ y © existen en su juego de caracteres.
          if (cp === 0xa3) bytes.push(0x60);
          else if (cp === 0xa9) bytes.push(0x7f);
          else { err(`carácter '${String.fromCodePoint(cp)}' fuera del juego del Spectrum`, line, j - lineStart + 1); bytes.push(63); }
          j += cp > 0xffff ? 2 : 1;
          continue;
        }
        bytes.push(cp === 0xa3 ? 0x60 : cp === 0xa9 ? 0x7f : cp);
        j++;
      }
      const t = tok(q === 34 ? "str" : "chr", src.slice(i, j));
      if (!closed) err(q === 34 ? "cadena sin cerrar" : "carácter sin cerrar", t.line, t.col);
      if (q === 34) t.bytes = bytes;
      else {
        if (bytes.length === 0) err("carácter vacío", t.line, t.col);
        // Multicarácter como gcc: el último en el byte bajo. Tipo int, char con signo no: char es unsigned.
        let v = 0;
        for (const b of bytes) v = ((v << 8) | b) & 0xffff;
        if (bytes.length > 1) err("constante de varios caracteres", t.line, t.col);
        t.n = v;
      }
      i = j;
      continue;
    }

    const s3 = src.substr(i, 3), s2 = src.substr(i, 2);
    if (PUNCS3.includes(s3)) { tok("punc", s3); i += 3; continue; }
    if (PUNCS2.includes(s2)) { tok("punc", s2); i += 2; continue; }
    if (PUNCS1.includes(src[i]!)) { tok("punc", src[i]!); i++; continue; }
    err(`carácter inesperado '${src[i]}'`, line, col);
    i++;
  }
}
