// Manifiesto de cinta (.tape): el "proyecto" de un juego que no cabe en un único bloque de
// código. Describe, en orden, los bloques de la cinta que debe generar el IDE; el contenido
// de cada uno sale del ensamblado de una pestaña (.asm o .c) o del texto BASIC del propio
// manifiesto. TS puro, sin DOM: la construcción de la cinta está en ui/tabs/project.ts.
//
//   { "v": 1, "name": "Sootland",
//     "blocks": [
//       { "type": "basic", "name": "SHOOT", "autostart": 10, "source": "10 CLEAR 24999\n…" },
//       { "type": "code",  "name": "loader.bin", "src": "loader.asm", "addr": "0xAFC8" },
//       { "type": "data",  "flag": 255, "src": "engine.asm", "addr": "0xD778", "len": 10370 } ] }
//
//  basic  Programa BASIC: cabecera (tipo 0) + datos. `autostart` = línea de arranque.
//  code   Bytes con cabecera (tipo 3, LOAD "nombre" CODE): dirección y longitud en la cabecera.
//  data   Bloque sin cabecera (el que carga LD-BYTES con IX, DE, A = flag): sólo el flag y los datos.
//
// Los bytes de code/data son los que el ensamblado de `src` dejó desde `addr`: `len` bytes,
// o, si no se da, el tramo contiguo que empieza en `addr`. Direcciones y flags son números
// o cadenas ("0xAFC8", "AFC8h", "45000").
import type { ResourceKind } from "./registry";

export interface BasicBlock { type: "basic"; name: string; source: string; autostart?: number }
export interface CodeBlock { type: "code"; name: string; src: string; addr: number; len?: number; param2?: number }
export interface DataBlock { type: "data"; flag: number; src: string; addr: number; len?: number }
export type TapeBlock = BasicBlock | CodeBlock | DataBlock;
export interface TapeDoc { v: 1; name: string; blocks: TapeBlock[] }

export function parseNumber(v: unknown, what: string): number {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    const m = /^(?:0x([0-9a-f]+)|([0-9a-f]+)h|(\d+))$/i.exec(s);
    if (m) return m[1] !== undefined ? parseInt(m[1], 16) : m[2] !== undefined ? parseInt(m[2], 16) : parseInt(m[3]!, 10);
  }
  throw new Error(`${what}: se esperaba un número (o "0x…", "…h")`);
}

const inRange = (n: number, lo: number, hi: number, what: string) => {
  if (n < lo || n > hi) throw new Error(`${what}: ${n} fuera de ${lo}–${hi}`);
  return n;
};

/** Lanza con el motivo si el documento no es válido. */
export function parseTapeDoc(text: string): TapeDoc {
  let d: unknown;
  try { d = JSON.parse(text); } catch { throw new Error("el documento no es JSON válido"); }
  const o = d as { v?: unknown; name?: unknown; blocks?: unknown } | null;
  if (!o || o.v !== 1 || !Array.isArray(o.blocks)) throw new Error("documento .tape desconocido (se esperaba v:1 y blocks)");
  const blocks: TapeBlock[] = o.blocks.map((raw, i): TapeBlock => {
    const b = raw as Record<string, unknown>;
    const at = `bloque ${i + 1}`;
    const str = (k: string) => { if (typeof b[k] !== "string" || b[k] === "") throw new Error(`${at}: falta «${k}»`); return b[k] as string; };
    const opt = (k: string, lo: number, hi: number) => (b[k] === undefined ? undefined : inRange(parseNumber(b[k], `${at}: ${k}`), lo, hi, `${at}: ${k}`));
    if (b.type === "basic") {
      return { type: "basic", name: str("name"), source: str("source"), autostart: opt("autostart", 0, 9999) };
    }
    if (b.type === "code") {
      return {
        type: "code", name: str("name"), src: str("src"), addr: inRange(parseNumber(b.addr, `${at}: addr`), 0, 0xffff, `${at}: addr`),
        len: opt("len", 1, 0xfffd), param2: opt("param2", 0, 0xffff),
      };
    }
    if (b.type === "data") {
      return {
        type: "data", flag: inRange(parseNumber(b.flag ?? 255, `${at}: flag`), 0, 255, `${at}: flag`), src: str("src"),
        addr: inRange(parseNumber(b.addr, `${at}: addr`), 0, 0xffff, `${at}: addr`), len: opt("len", 1, 0xfffd),
      };
    }
    throw new Error(`${at}: tipo desconocido «${String(b.type)}» (basic, code o data)`);
  });
  return { v: 1, name: typeof o.name === "string" ? o.name : "", blocks };
}

export function serializeTapeDoc(doc: TapeDoc): string {
  return JSON.stringify({ v: 1, name: doc.name, blocks: doc.blocks }, null, 1);
}

export const tapeResource: ResourceKind = {
  ext: "tape",
  label: "Cinta (proyecto)",
  template: () => serializeTapeDoc({
    v: 1, name: "Mi juego",
    blocks: [
      { type: "basic", name: "LOADER", autostart: 10, source: '10 CLEAR 32767\n20 LOAD "" CODE\n30 RANDOMIZE USR 32768' },
      { type: "code", name: "juego", src: "main.asm", addr: 32768 },
    ],
  }),
  check(text) {
    try { parseTapeDoc(text); return null; } catch (e) { return (e as Error).message; }
  },
  toBin() { throw new Error("una cinta no se puede incluir con INCBIN: se construye con Ejecutar o Exportar TAP"); },
};
