// Mapas de tiles (.map): cuadrícula de w×h celdas, cada una el índice (0-255) de un tile del
// conjunto .tiles al que está ligado el mapa, más una capa de marcadores (tipo, columna, fila)
// para lo que el código coloca encima: enemigos, objetos, punto de inicio... TS puro, sin DOM.
// Formato del documento y de los binarios: docs/recursos.md.
import type { ResourceKind } from "./registry";

export const MAX_DIM = 255;
export const MAX_MARKS = 255;

export interface Marker {
  /** Tipo: un byte que el código interpreta. */
  k: number;
  /** Columna y fila de la celda. */
  c: number;
  r: number;
}

export interface MapDoc {
  w: number;
  h: number;
  /** Nombre de la pestaña .tiles que da el aspecto ("" = sin ligar). */
  tiles: string;
  /** h filas de w índices. */
  data: number[][];
  marks: Marker[];
}

export function newMap(w = 32, h = 24, tiles = ""): MapDoc {
  return { w, h, tiles, data: Array.from({ length: h }, () => Array<number>(w).fill(0)), marks: [] };
}

// ---- Documento ----

export function serializeMap(m: MapDoc): string {
  const rows = m.data.map((r) => JSON.stringify(r)).join(",\n");
  const marks = m.marks.map((k) => JSON.stringify(k)).join(",\n");
  return `{"v":1,"w":${m.w},"h":${m.h},"tiles":${JSON.stringify(m.tiles)},"data":[\n${rows}\n],"marks":[${marks ? "\n" + marks + "\n" : ""}]}`;
}

const isByte = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255;
const isDim = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_DIM;

/** Lanza con el motivo si el documento no es válido. */
export function parseMapDoc(text: string): MapDoc {
  let d: unknown;
  try { d = JSON.parse(text); } catch { throw new Error("el documento no es JSON válido"); }
  const o = d as { v?: unknown; w?: unknown; h?: unknown; tiles?: unknown; data?: unknown; marks?: unknown } | null;
  if (!o || o.v !== 1) throw new Error("documento .map desconocido (se esperaba v:1)");
  if (!isDim(o.w) || !isDim(o.h)) throw new Error(`w y h deben ser enteros entre 1 y ${MAX_DIM}`);
  if (typeof o.tiles !== "string") throw new Error("tiles debe ser el nombre de una pestaña .tiles (o \"\")");
  if (!Array.isArray(o.data) || o.data.length !== o.h) throw new Error(`data debe tener ${o.h} filas`);
  const data = (o.data as unknown[]).map((row, y) => {
    if (!Array.isArray(row) || row.length !== o.w || !row.every(isByte)) throw new Error(`fila ${y}: deben ser ${o.w} índices entre 0 y 255`);
    return [...(row as number[])];
  });
  if (!Array.isArray(o.marks)) throw new Error("marks debe ser una lista");
  if (o.marks.length > MAX_MARKS) throw new Error(`hay ${o.marks.length} marcadores y el máximo es ${MAX_MARKS}`);
  const seen = new Set<number>();
  const marks = (o.marks as unknown[]).map((raw, i): Marker => {
    const k = raw as Partial<Marker> | null;
    if (!k || !isByte(k.k) || !isByte(k.c) || !isByte(k.r)) throw new Error(`marcador ${i}: k, c y r deben ser bytes`);
    if (k.c >= (o.w as number) || k.r >= (o.h as number)) throw new Error(`marcador ${i}: (${k.c}, ${k.r}) cae fuera del mapa`);
    const key = k.r * 256 + k.c;
    if (seen.has(key)) throw new Error(`marcador ${i}: ya hay otro en la celda (${k.c}, ${k.r})`);
    seen.add(key);
    return { k: k.k, c: k.c, r: k.r };
  });
  return { w: o.w, h: o.h, tiles: o.tiles, data, marks };
}

// ---- Binarios ----

/** Celdas fila a fila: w·h bytes. */
export function cellBytes(m: MapDoc): Uint8Array {
  const out = new Uint8Array(m.w * m.h);
  m.data.forEach((row, y) => out.set(row, y * m.w));
  return out;
}

/** Celdas columna a columna (de arriba abajo, de izquierda a derecha): útil para scroll horizontal. */
export function columnBytes(m: MapDoc): Uint8Array {
  const out = new Uint8Array(m.w * m.h);
  for (let x = 0; x < m.w; x++) for (let y = 0; y < m.h; y++) out[x * m.h + y] = m.data[y]![x]!;
  return out;
}

/** RLE de pares (cuenta 1-255, valor) sobre un flujo de bytes. */
export function rle(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length;) {
    let n = 1;
    while (i + n < bytes.length && bytes[i + n] === bytes[i] && n < 255) n++;
    out.push(n, bytes[i]!);
    i += n;
  }
  return Uint8Array.from(out);
}

export function unrle(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) for (let n = 0; n < data[i]!; n++) out.push(data[i + 1]!);
  return Uint8Array.from(out);
}

/** Marcadores: 3 bytes cada uno (tipo, columna, fila), en el orden del documento. */
export function markBytes(m: MapDoc): Uint8Array {
  return Uint8Array.from(m.marks.flatMap((k) => [k.k, k.c, k.r]));
}

/** Constantes del mapa para INCLUDE "nombre.map#inc". `base` es el nombre sin extensión. */
export function mapInc(m: MapDoc, base: string): string {
  const b = base.replace(/[^A-Za-z0-9_]/g, "_");
  return [
    "; Generado por el editor de mapas: no editar.",
    `${b}_W\tequ ${m.w}\t\t; columnas`,
    `${b}_H\tequ ${m.h}\t\t; filas`,
    `${b}_CELLS\tequ ${m.w * m.h}\t\t; w*h: bytes del mapa sin comprimir`,
    `${b}_RLE_BYTES\tequ ${rle(cellBytes(m)).length}\t\t; bytes de ${base}#rle`,
    `${b}_MARKS\tequ ${m.marks.length}\t\t; marcadores (3 bytes cada uno en ${base}#marks)`,
  ].join("\n") + "\n";
}

// ---- Edición (puras salvo que se diga) ----

/** Cambia el tamaño conservando lo que cabe (ancla arriba-izquierda); lo nuevo es el tile `fill`. Descarta marcadores que quedan fuera. */
export function resizeMap(m: MapDoc, w: number, h: number, fill = 0): MapDoc {
  const data = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => m.data[y]?.[x] ?? fill));
  return { ...m, w, h, data, marks: m.marks.filter((k) => k.c < w && k.r < h) };
}

/** Rectángulo (inclusive, en cualquier orden de esquinas) relleno con el tile `v`. Modifica `m`. */
export function fillRect(m: MapDoc, c0: number, r0: number, c1: number, r1: number, v: number): void {
  for (let y = Math.max(0, Math.min(r0, r1)); y <= Math.min(m.h - 1, Math.max(r0, r1)); y++) {
    for (let x = Math.max(0, Math.min(c0, c1)); x <= Math.min(m.w - 1, Math.max(c0, c1)); x++) m.data[y]![x] = v;
  }
}

/** Relleno por inundación (4 vecinos) de la región del mismo tile que (c, r). Modifica `m`; devuelve las celdas cambiadas. */
export function floodFill(m: MapDoc, c: number, r: number, v: number): number {
  if (c < 0 || r < 0 || c >= m.w || r >= m.h) return 0;
  const from = m.data[r]![c]!;
  if (from === v) return 0;
  let n = 0;
  const stack: Array<[number, number]> = [[c, r]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h || m.data[y]![x] !== from) continue;
    m.data[y]![x] = v;
    n++;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return n;
}

/** Pone el marcador (sustituyendo el de esa celda) o lo quita si `k` es null. Modifica `m`. Devuelve false si ya hay MAX_MARKS. */
export function setMarker(m: MapDoc, c: number, r: number, k: number | null): boolean {
  const i = m.marks.findIndex((x) => x.c === c && x.r === r);
  if (k === null) { if (i >= 0) m.marks.splice(i, 1); return true; }
  if (i >= 0) { m.marks[i]!.k = k; return true; }
  if (m.marks.length >= MAX_MARKS) return false;
  m.marks.push({ k, c, r });
  return true;
}

/** Mayor índice de tile usado (para avisar si el conjunto ligado tiene menos). */
export function maxTileUsed(m: MapDoc): number {
  let max = 0;
  for (const row of m.data) for (const v of row) if (v > max) max = v;
  return max;
}

export const mapResource: ResourceKind = {
  ext: "map",
  label: "Mapa",
  template: () => serializeMap(newMap(32, 24)),
  check(text) {
    try { parseMapDoc(text); return null; } catch (e) { return (e as Error).message; }
  },
  toBin: (text) => cellBytes(parseMapDoc(text)),
  parts: {
    cols: (text) => columnBytes(parseMapDoc(text)),
    rle: (text) => rle(cellBytes(parseMapDoc(text))),
    marks: (text) => markBytes(parseMapDoc(text)),
  },
  inc: (text, base) => mapInc(parseMapDoc(text), base),
};
