// typeKeys: teclea texto en el editor de BASIC de la ROM 48K pulsando y soltando
// teclas de la matriz en frames concretos (zx_key) y ejecutando frames entre medias.
//
// Fuentes:
//  - Matriz de teclas: docs/zx48-hardware.md §6.
//  - Palabras clave de cada tecla: la PROPIA ROM (no tablas escritas a mano), según
//    The Complete Spectrum ROM Disassembly (Logan & O'Hara):
//      TKN-TABLE 0x0095   nombres de los tokens 0xA5..0xFF (último carácter con bit 7)
//      modo K             token = letra + 0xA5 (A → NEW … Z → COPY; rutina K-KEYWORD)
//      E-UNSHIFT 0x022C   modo E, letra sola (A..Z)
//      EXT-SHIFT 0x0246   modo E, SYMBOL SHIFT + letra
//      CTL-CODES 0x0260   CAPS SHIFT + dígito (0x0260..0x0269: 0 = DELETE …)
//      SYM-CODES 0x026A   modo L, SYMBOL SHIFT + letra
//      E-DIGITS  0x0284   modo E, SYMBOL SHIFT + dígito
//    Los símbolos de SYMBOL SHIFT + dígito (! @ # $ % & ' ( ) _) están impresos en el
//    teclado (manual del 48K, cap. 1).
//  - Temporización: la ROM explora el teclado en cada INT (KEYBOARD, 0x02BF). Una
//    tecla nueva se registra en el primer frame en que se ve; al soltarla, su entrada
//    de KSTATE tarda 5 INT en liberarse, así que la misma tecla dos veces seguidas
//    necesita ≥ 5 frames sin pulsar. Repetición automática tras REPDEL = 35 frames.
//    Por defecto: 3 frames pulsada y 8 soltada.
//
// Modos (los decide la ROM; aquí se predicen):
//  - K al principio de cada línea, tras ':' y tras THEN. En K una letra es la palabra
//    clave de esa tecla; los dígitos (número de línea) se teclean tal cual.
//  - L en el resto. Letras minúsculas = tecla; mayúsculas = CAPS SHIFT + tecla.
//  - E (CAPS SHIFT + SYMBOL SHIFT) para las funciones de E-UNSHIFT/EXT-SHIFT/E-DIGITS;
//    tras la función la ROM vuelve a L.
//
// LIMITACIONES (documentadas a propósito):
//  - En modo K sólo se aceptan dígitos, espacios y palabras clave del modo K; un texto
//    como "a=1" al principio de línea lanza un error (hay que escribir "LET a=1").
//  - En modo L una palabra en MAYÚSCULAS que coincide con un token (y no va seguida de
//    otra letra) se teclea como token. Para escribir esas letras sueltas, usar
//    minúsculas o ponerlas entre comillas.
//  - Fuera de comillas se omiten los espacios contiguos a un token: la ROM ya imprime
//    los suyos. Dentro de comillas todo es literal.
//  - No se predice CAPS LOCK, modo G (gráficos) ni los modos de color en E + dígito.
//  - "\b" = DELETE (CAPS SHIFT + 0). "\n" = ENTER.
//  - Hay que llamarla con la ROM esperando una tecla (p. ej. tras el arranque, ≥ 100
//    frames desde el reset, o tras "0 OK").

import type { Core } from "../../web/src/emu/core";

/** DOC §6: [row, bit] de cada tecla. row 0..7 = semifilas 0xFEFE..0x7FFE. */
export const KEY: Record<string, readonly [number, number]> = {};
const MATRIX = [
  ["CAPS", "Z", "X", "C", "V"],
  ["A", "S", "D", "F", "G"],
  ["Q", "W", "E", "R", "T"],
  ["1", "2", "3", "4", "5"],
  ["0", "9", "8", "7", "6"],
  ["P", "O", "I", "U", "Y"],
  ["ENTER", "L", "K", "J", "H"],
  ["SPACE", "SYM", "M", "N", "B"],
];
MATRIX.forEach((row, r) => row.forEach((name, b) => { KEY[name] = [r, b] as const; }));

/** Teclas pulsadas a la vez en un golpe. */
export type Stroke = string[];

export interface KeyTables {
  tokens: Map<number, string>;
  kMode: Map<string, string>; // palabra clave → letra
  /** Cadena tecleable en modo L / E → golpes necesarios (sin incluir el cambio a E). */
  lTokens: Map<string, { strokes: Stroke[]; toK: boolean }>;
  /** Carácter literal → golpe (modo L). */
  chars: Map<string, Stroke>;
}

const SPECIAL_CHAR: Record<number, string> = { 0x5e: "↑", 0x60: "£", 0x7f: "©" };

/** Construye las tablas a partir de la ROM (0x0000–0x3FFF). */
export function keyTables(rom: Uint8Array): KeyTables {
  const tokens = new Map<number, string>();
  let p = 0x0095;
  let s = "";
  for (let code = 0xa4; code <= 0xff; ) {
    const b = rom[p++]!;
    s += String.fromCharCode(b & 0x7f);
    if (b & 0x80) {
      tokens.set(code++, s);
      s = "";
    }
  }
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const kMode = new Map<string, string>();
  for (const L of letters) kMode.set(tokens.get(L.charCodeAt(0) + 0xa5)!, L);

  const lTokens = new Map<string, { strokes: Stroke[]; toK: boolean }>();
  const chars = new Map<string, Stroke>();
  const E: Stroke = ["CAPS", "SYM"];
  const name = (code: number) => tokens.get(code) ?? SPECIAL_CHAR[code] ?? String.fromCharCode(code);
  const add = (code: number, strokes: Stroke[]) => {
    const n = name(code);
    if (code >= 0xa5) {
      if (!lTokens.has(n)) lTokens.set(n, { strokes, toK: n === "THEN" });
    } else if (!chars.has(n) && strokes.length === 1) {
      chars.set(n, strokes[0]!);
    } else if (!lTokens.has(n) && !chars.has(n)) {
      lTokens.set(n, { strokes, toK: false });
    }
  };
  // Modo L primero (preferido si el mismo carácter existe en dos sitios).
  for (let i = 0; i < 26; i++) add(rom[0x026a + i]!, [["SYM", letters[i]!]]);
  const symDigits = "_!@#$%&'()"; // teclado del 48K: SYM + 0..9
  for (let d = 0; d < 10; d++) chars.set(symDigits[d]!, ["SYM", String(d)]);
  for (let i = 0; i < 26; i++) add(rom[0x022c + i]!, [E, [letters[i]!]]);
  for (let i = 0; i < 26; i++) add(rom[0x0246 + i]!, [E, ["SYM", letters[i]!]]);
  for (let d = 0; d < 10; d++) add(rom[0x0284 + d]!, [E, ["SYM", String(d)]]);
  for (const L of letters) {
    chars.set(L.toLowerCase(), [L]);
    chars.set(L, ["CAPS", L]);
  }
  for (let d = 0; d < 10; d++) chars.set(String(d), [String(d)]);
  chars.set(" ", ["SPACE"]);
  return { tokens, kMode, lTokens, chars };
}

/** Traduce texto a golpes de teclado. Lanza un error si algo no se puede teclear. */
export function textToStrokes(text: string, tables: KeyTables): Stroke[] {
  const out: Stroke[] = [];
  let mode: "K" | "L" = "K";
  let inQuote = false;
  let lastWasToken = false;
  const isLetter = (c: string | undefined) => c !== undefined && /[A-Za-z$]/.test(c);
  const kNames = [...tables.kMode.keys()].sort((a, b) => b.length - a.length);
  const lNames = [...tables.lTokens.keys()].sort((a, b) => b.length - a.length);

  const matchAt = (i: number, names: string[]): string | null => {
    for (const n of names) {
      if (!text.startsWith(n, i)) continue;
      const alpha = /[A-Z]/.test(n[0]!);
      if (alpha && (isLetter(text[i + n.length]) || isLetter(text[i - 1]))) continue;
      return n;
    }
    return null;
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\n") {
      out.push(["ENTER"]);
      mode = "K";
      inQuote = false;
      lastWasToken = false;
      i++;
      continue;
    }
    if (c === "\b") {
      out.push(["CAPS", "0"]);
      i++;
      continue;
    }
    if (mode === "K") {
      if (c === " ") { i++; continue; }
      if (/[0-9]/.test(c)) { out.push([c]); i++; continue; }
      const kw = matchAt(i, kNames);
      if (!kw) throw new Error(`typeKeys: "${text.slice(i, i + 10)}…" en modo K no es una palabra clave del modo K`);
      out.push([tables.kMode.get(kw)!]);
      i += kw.length;
      if (text[i] === " ") i++;
      mode = "L";
      lastWasToken = true;
      continue;
    }
    // Modo L.
    if (inQuote) {
      if (c === '"') { out.push(["SYM", "P"]); inQuote = false; i++; continue; }
      const st = tables.chars.get(c);
      if (!st) throw new Error(`typeKeys: carácter no tecleable entre comillas: ${JSON.stringify(c)}`);
      out.push(st);
      i++;
      continue;
    }
    if (c === " ") {
      let j = i;
      while (text[j] === " ") j++;
      if (lastWasToken || matchAt(j, lNames)) { i = j; continue; }
      out.push(["SPACE"]);
      i++;
      lastWasToken = false;
      continue;
    }
    if (c === '"') { out.push(["SYM", "P"]); inQuote = true; i++; lastWasToken = false; continue; }
    const tk = matchAt(i, lNames);
    if (tk) {
      const t = tables.lTokens.get(tk)!;
      out.push(...t.strokes);
      i += tk.length;
      lastWasToken = true;
      if (t.toK) mode = "K";
      continue;
    }
    const st = tables.chars.get(c);
    if (!st) throw new Error(`typeKeys: carácter no tecleable: ${JSON.stringify(c)}`);
    out.push(st);
    i++;
    lastWasToken = false;
    if (c === ":") mode = "K";
  }
  return out;
}

export interface TypeKeysOptions {
  hold?: number; // frames pulsada (por defecto 3)
  gap?: number; // frames soltada (por defecto 8)
}

/**
 * Teclea `text` en `core` (ROM 48K arrancada). Ejecuta frames con zx_run_frame y
 * devuelve cuántos ha ejecutado. Las tablas salen de la ROM cargada en la RAM del
 * núcleo (0x0000–0x3FFF).
 */
export function typeKeys(core: Core, text: string, opts: TypeKeysOptions = {}): number {
  const hold = opts.hold ?? 3;
  const gap = opts.gap ?? 8;
  const tables = keyTables(core.ram().slice(0, 0x4000));
  const strokes = textToStrokes(text, tables);
  let frames = 0;
  for (const st of strokes) {
    for (const k of st) core.x.zx_key(KEY[k]![0], KEY[k]![1], 1);
    for (let f = 0; f < hold; f++, frames++) core.runFrame();
    for (const k of st) core.x.zx_key(KEY[k]![0], KEY[k]![1], 0);
    for (let f = 0; f < gap; f++, frames++) core.runFrame();
  }
  return frames;
}
