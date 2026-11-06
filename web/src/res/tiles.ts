// Conjuntos de tiles (.tiles): tiles de 8×8 o de 16×16 con atributo de color y propiedades
// que interpreta el código del usuario. TS puro, sin DOM. Formato del documento y de los
// binarios: docs/recursos.md.
//
// Compatible con los tiles de zxgen: píxeles como cadenas de "X" (tinta) y "." (papel);
// en binario, 16×16 = 16 filas de 2 bytes (alto, bajo) y 4 atributos (arriba-izq,
// arriba-dcha, abajo-izq, abajo-dcha), uno por cuadro de 8×8.
import { convertCells, type ConvertOptions } from "./scr";
import type { ResourceKind } from "./registry";

export type TileSize = 8 | 16;

export interface Tile {
  /** size cadenas de size caracteres: "X" tinta, "." papel. */
  pix: string[];
  /** Atributos (BRIGHT<<6 | PAPER<<3 | INK): 1 si size = 8, 4 si 16 (TL, TR, BL, BR). */
  atr: number[];
  /** Banderas (hasta 8; sus nombres están en TileSet.flags). */
  props: number;
  /** Un byte libre para el código: puntos, fase de destino, etc. */
  val: number;
  /** Identificador opcional ("" = sin nombre) para generar su constante. */
  name: string;
}

export interface TileSet {
  size: TileSize;
  /** Nombres (identificadores de ensamblador) de los 8 bits de props, del 0 al 7. */
  flags: string[];
  tiles: Tile[];
}

export const MAX_TILES = 256;
export const DEFAULT_FLAGS = ["SOLID", "BLOCKS_SHOTS", "HURTS", "DOOR", "ITEM", "LADDER", "WATER", "SPECIAL"];
/** Papel blanco, tinta negra, sin brillo: lo que deja CLS. */
export const DEFAULT_ATTR = 0x38;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const attrCells = (size: TileSize): number => (size === 16 ? 4 : 1);

export function emptyTile(size: TileSize, attr = DEFAULT_ATTR): Tile {
  return { pix: Array.from({ length: size }, () => ".".repeat(size)), atr: Array(attrCells(size)).fill(attr) as number[], props: 0, val: 0, name: "" };
}

export function newTileSet(size: TileSize = 16): TileSet {
  return { size, flags: [...DEFAULT_FLAGS], tiles: [emptyTile(size)] };
}

// ---- Documento ----

export function serializeTileSet(ts: TileSet): string {
  const rows = ts.tiles.map((t) => JSON.stringify({ name: t.name, pix: t.pix, atr: t.atr, props: t.props, val: t.val }));
  return `{"v":1,"size":${ts.size},"flags":${JSON.stringify(ts.flags)},"tiles":[\n${rows.join(",\n")}\n]}`;
}

const isByte = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255;

/** Lanza con el motivo si el documento no es válido. */
export function parseTileDoc(text: string): TileSet {
  let d: unknown;
  try { d = JSON.parse(text); } catch { throw new Error("el documento no es JSON válido"); }
  const o = d as { v?: unknown; size?: unknown; flags?: unknown; tiles?: unknown } | null;
  if (!o || o.v !== 1) throw new Error("documento .tiles desconocido (se esperaba v:1)");
  if (o.size !== 8 && o.size !== 16) throw new Error("size debe ser 8 o 16");
  const size = o.size;
  if (!Array.isArray(o.flags) || o.flags.length !== 8) throw new Error("flags debe tener 8 nombres");
  const seen = new Set<string>();
  for (const f of o.flags) {
    if (typeof f !== "string" || !IDENT.test(f)) throw new Error(`nombre de bandera no válido: ${JSON.stringify(f)} (letras, cifras y _; no empieza por cifra)`);
    if (seen.has(f.toUpperCase())) throw new Error(`nombre de bandera repetido: ${f}`);
    seen.add(f.toUpperCase());
  }
  if (!Array.isArray(o.tiles) || o.tiles.length < 1) throw new Error("tiles debe tener al menos un tile");
  if (o.tiles.length > MAX_TILES) throw new Error(`hay ${o.tiles.length} tiles y el máximo es ${MAX_TILES} (índice de un byte)`);
  const names = new Set<string>();
  const tiles = (o.tiles as unknown[]).map((raw, i): Tile => {
    const t = raw as Partial<Tile> | null;
    const at = `tile ${i}`;
    if (!t || !Array.isArray(t.pix) || t.pix.length !== size) throw new Error(`${at}: pix debe tener ${size} filas`);
    for (const row of t.pix) {
      if (typeof row !== "string" || row.length !== size || /[^X.]/.test(row)) throw new Error(`${at}: cada fila de pix son ${size} caracteres «X» o «.»`);
    }
    if (!Array.isArray(t.atr) || t.atr.length !== attrCells(size) || !t.atr.every((a) => isByte(a) && a < 128)) {
      throw new Error(`${at}: atr debe tener ${attrCells(size)} atributos entre 0 y 127`);
    }
    if (!isByte(t.props)) throw new Error(`${at}: props debe ser un byte`);
    if (!isByte(t.val)) throw new Error(`${at}: val debe ser un byte`);
    const name = t.name ?? "";
    if (typeof name !== "string" || (name !== "" && !IDENT.test(name))) throw new Error(`${at}: nombre no válido ${JSON.stringify(name)}`);
    if (name !== "") {
      if (names.has(name.toUpperCase())) throw new Error(`${at}: nombre repetido ${name}`);
      names.add(name.toUpperCase());
    }
    return { pix: [...t.pix] as string[], atr: [...t.atr] as number[], props: t.props, val: t.val, name };
  });
  return { size, flags: [...(o.flags as string[])], tiles };
}

// ---- Binarios ----

/** Gráficos: por tile, size filas de size/8 bytes (alto primero). 8×8 → 8 bytes; 16×16 → 32. */
export function gfxBytes(ts: TileSet): Uint8Array {
  const per = ts.size * (ts.size >> 3);
  const out = new Uint8Array(ts.tiles.length * per);
  ts.tiles.forEach((t, i) => {
    t.pix.forEach((row, y) => {
      for (let b = 0; b < ts.size >> 3; b++) {
        let v = 0;
        for (let x = 0; x < 8; x++) v = (v << 1) | (row[b * 8 + x] === "X" ? 1 : 0);
        out[i * per + y * (ts.size >> 3) + b] = v;
      }
    });
  });
  return out;
}

export const attrBytes = (ts: TileSet): Uint8Array => Uint8Array.from(ts.tiles.flatMap((t) => t.atr));
export const propBytes = (ts: TileSet): Uint8Array => Uint8Array.from(ts.tiles.map((t) => t.props));
export const valBytes = (ts: TileSet): Uint8Array => Uint8Array.from(ts.tiles.map((t) => t.val));

/** Constantes del conjunto para INCLUDE "nombre.tiles#inc". `base` es el nombre sin extensión. */
export function tilesInc(ts: TileSet, base: string): string {
  const b = base.replace(/[^A-Za-z0-9_]/g, "_");
  const l = [
    `; Generado por el editor de tiles: no editar.`,
    `${b}_COUNT\tequ ${ts.tiles.length}\t\t; número de tiles`,
    `${b}_SIZE\tequ ${ts.size}\t\t; lado en píxeles`,
    `${b}_GFX_BYTES\tequ ${ts.size * (ts.size >> 3)}\t\t; bytes de gráficos por tile`,
    `${b}_ATTRS\tequ ${attrCells(ts.size)}\t\t; atributos por tile`,
  ];
  ts.flags.forEach((f, i) => l.push(`${b}_${f}\tequ ${1 << i}\t\t; bit ${i} de props`));
  ts.tiles.forEach((t, i) => { if (t.name) l.push(`${b}_T_${t.name}\tequ ${i}\t\t; índice del tile`); });
  return l.join("\n") + "\n";
}

// ---- Edición de píxeles (puras: devuelven filas nuevas) ----

const rowsOf = (pix: readonly string[]) => pix.map((r) => [...r]);

export function setPixel(pix: readonly string[], x: number, y: number, ink: boolean): string[] {
  if (y < 0 || y >= pix.length || x < 0 || x >= pix[0]!.length) return [...pix];
  const row = [...pix[y]!];
  row[x] = ink ? "X" : ".";
  return pix.map((r, i) => (i === y ? row.join("") : r));
}

export const flipH = (pix: readonly string[]): string[] => pix.map((r) => [...r].reverse().join(""));
export const flipV = (pix: readonly string[]): string[] => [...pix].reverse();
export const invertPix = (pix: readonly string[]): string[] => pix.map((r) => [...r].map((c) => (c === "X" ? "." : "X")).join(""));

/** Giro de 90° a la derecha (los tiles son cuadrados). */
export function rotate90(pix: readonly string[]): string[] {
  const n = pix.length, g = rowsOf(pix);
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => g[n - 1 - x]![y]!).join(""));
}

/** Desplaza el dibujo dx, dy píxeles (con vuelta por el otro lado). */
export function shiftPix(pix: readonly string[], dx: number, dy: number): string[] {
  const n = pix.length, g = rowsOf(pix), m = (v: number) => ((v % n) + n) % n;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => g[m(y - dy)]![m(x - dx)]!).join(""));
}

/** Giros y reflejos de los atributos de los cuatro cuadros de un 16×16 acompañan al dibujo. */
export function flipHAttrs(atr: readonly number[]): number[] { return atr.length === 4 ? [atr[1]!, atr[0]!, atr[3]!, atr[2]!] : [...atr]; }
export function flipVAttrs(atr: readonly number[]): number[] { return atr.length === 4 ? [atr[2]!, atr[3]!, atr[0]!, atr[1]!] : [...atr]; }
export function rotate90Attrs(atr: readonly number[]): number[] { return atr.length === 4 ? [atr[2]!, atr[0]!, atr[3]!, atr[1]!] : [...atr]; }

// ---- Importar una hoja de imagen ----

/**
 * Corta una imagen RGBA en tiles de size×size (de izquierda a derecha y de arriba abajo; lo
 * que sobre por la derecha o abajo se ignora) y la convierte a tinta/papel con los mismos
 * criterios que las pantallas. Devuelve como mucho MAX_TILES tiles.
 */
export function tilesFromImage(rgba: ArrayLike<number>, w: number, h: number, size: TileSize, opts: ConvertOptions): Tile[] {
  const cols = Math.floor(w / size), rows = Math.floor(h / size);
  if (cols < 1 || rows < 1) throw new Error(`la imagen (${w}×${h}) es menor que un tile de ${size}×${size}`);
  const cw = cols * size, ch = rows * size;
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw * 4; x++) crop[y * cw * 4 + x] = rgba[y * w * 4 + x]!;
  const c = convertCells(crop, cw, ch, opts);
  const per = size >> 3, tiles: Tile[] = [];
  for (let ty = 0; ty < rows && tiles.length < MAX_TILES; ty++) {
    for (let tx = 0; tx < cols && tiles.length < MAX_TILES; tx++) {
      const t = emptyTile(size);
      for (let y = 0; y < size; y++) {
        let row = "";
        for (let x = 0; x < size; x++) row += c.bits[(ty * size + y) * cw + tx * size + x] ? "X" : ".";
        t.pix[y] = row;
      }
      for (let k = 0; k < per * per; k++) t.atr[k] = c.attrs[(ty * per + (k >> (per - 1))) * (cw >> 3) + tx * per + (k & (per - 1))]!;
      tiles.push(t);
    }
  }
  return tiles;
}

export const tilesResource: ResourceKind = {
  ext: "tiles",
  label: "Tiles",
  template: () => serializeTileSet(newTileSet(16)),
  check(text) {
    try { parseTileDoc(text); return null; } catch (e) { return (e as Error).message; }
  },
  toBin: (text) => gfxBytes(parseTileDoc(text)),
  parts: {
    attr: (text) => attrBytes(parseTileDoc(text)),
    props: (text) => propBytes(parseTileDoc(text)),
    val: (text) => valBytes(parseTileDoc(text)),
  },
  inc: (text, base) => tilesInc(parseTileDoc(text), base),
};

