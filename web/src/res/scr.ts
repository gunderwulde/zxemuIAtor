// Pantallas del Spectrum (SCREEN$): 6912 bytes = 6144 de bitmap + 768 de atributos.
// Formato y direcciones: docs/zx48-hardware.md (§3). Aquí sólo hay datos y conversión,
// sin DOM: el redimensionado de la imagen (canvas) lo hace la UI y llega como RGBA 256×192.
import type { ResourceKind } from "./registry";

export const SCR_W = 256;
export const SCR_H = 192;
export const BITMAP_SIZE = 6144;
export const ATTR_SIZE = 768;
export const SCR_SIZE = BITMAP_SIZE + ATTR_SIZE;

/** Índice GRB + 8·BRIGHT; mismos valores que core/src/video.c (0xD7 normal, 0xFF brillante). */
export const PALETTE: ReadonlyArray<readonly [number, number, number]> = (() => {
  const p: Array<[number, number, number]> = [];
  for (const level of [0xd7, 0xff]) {
    for (let c = 0; c < 8; c++) p.push([c & 2 ? level : 0, c & 4 ? level : 0, c & 1 ? level : 0]);
  }
  return p;
})();

/**
 * Desplazamiento en el bitmap del byte que contiene el píxel (x, y). La ULA recorre el
 * bitmap en tercios: bits de y = T T L L L R R R (tercio, línea de pixel, fila de carácter).
 */
export function bitmapOffset(x: number, y: number): number {
  return ((y & 0xc0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2) | (x >> 3);
}

/** Pantalla en blanco: papel blanco, tinta negra, sin brillo (lo que deja CLS). */
export function emptyScr(): Uint8Array {
  const s = new Uint8Array(SCR_SIZE);
  s.fill(0x38, BITMAP_SIZE);
  return s;
}

/** RGBA 256×192 de una pantalla (el parpadeo se ignora: se ve el estado sin invertir). */
export function scrToRgba(scr: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SCR_W * SCR_H * 4);
  for (let y = 0; y < SCR_H; y++) {
    for (let x = 0; x < SCR_W; x++) {
      const a = scr[BITMAP_SIZE + (y >> 3) * 32 + (x >> 3)]!;
      const set = (scr[bitmapOffset(x, y)]! >> (7 - (x & 7))) & 1;
      const c = PALETTE[set ? (a & 7) | ((a >> 6) & 1) * 8 : ((a >> 3) & 7) | ((a >> 6) & 1) * 8]!;
      const o = (y * SCR_W + x) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
  }
  return out;
}

export interface ConvertOptions {
  /** "none": cada píxel a su color más cercano de la celda; "bayer": tramado ordenado 4×4. */
  dither: "none" | "bayer";
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// Pesos del error por canal (R, G, B): el ojo distingue más el verde.
const WR = 3, WG = 4, WB = 2;
const dist = (r: number, g: number, b: number, c: readonly [number, number, number]) =>
  WR * (r - c[0]) ** 2 + WG * (g - c[1]) ** 2 + WB * (b - c[2]) ** 2;

/**
 * RGBA 256×192 → pantalla. Cada celda de 8×8 admite dos colores (tinta y papel) y un
 * brillo común, así que se prueban los 2·8·8 = 128 pares y gana el de menor error total;
 * a igualdad, el de menos píxeles de tinta y luego el primero en orden (brillo, papel,
 * tinta). Un píxel a igual distancia de los dos va al papel. La transparencia se
 * compone sobre negro. Determinista: sin aleatorios.
 */
export function convertRgba(rgba: ArrayLike<number>, opts: ConvertOptions): Uint8Array {
  if (rgba.length !== SCR_W * SCR_H * 4) throw new Error("se esperaba una imagen RGBA de 256×192");
  const scr = new Uint8Array(SCR_SIZE);
  const px = new Int32Array(64 * 3);
  for (let cy = 0; cy < 24; cy++) {
    for (let cx = 0; cx < 32; cx++) {
      for (let k = 0; k < 64; k++) {
        const o = ((cy * 8 + (k >> 3)) * SCR_W + cx * 8 + (k & 7)) * 4;
        const a = rgba[o + 3]! / 255;
        px[k * 3] = Math.round(rgba[o]! * a);
        px[k * 3 + 1] = Math.round(rgba[o + 1]! * a);
        px[k * 3 + 2] = Math.round(rgba[o + 2]! * a);
      }
      let best = Infinity, bestInk = 65, bb = 0, bp = 0, bi = 0;
      for (let b = 0; b < 2; b++) {
        for (let p = 0; p < 8; p++) {
          for (let i = 0; i < 8; i++) {
            const cp = PALETTE[p + 8 * b]!, ci = PALETTE[i + 8 * b]!;
            let cost = 0, inks = 0;
            for (let k = 0; k < 64 && cost <= best; k++) {
              const r = px[k * 3]!, g = px[k * 3 + 1]!, bl = px[k * 3 + 2]!;
              const dp = dist(r, g, bl, cp), di = dist(r, g, bl, ci);
              if (di < dp) { cost += di; inks++; } else cost += dp;
            }
            if (cost < best || (cost === best && inks < bestInk)) { best = cost; bestInk = inks; bb = b; bp = p; bi = i; }
          }
        }
      }
      scr[BITMAP_SIZE + cy * 32 + cx] = (bb << 6) | (bp << 3) | bi;
      const cp = PALETTE[bp + 8 * bb]!, ci = PALETTE[bi + 8 * bb]!;
      const vr = ci[0] - cp[0], vg = ci[1] - cp[1], vb = ci[2] - cp[2];
      const len2 = vr * vr + vg * vg + vb * vb;
      for (let k = 0; k < 64; k++) {
        const x = cx * 8 + (k & 7), y = cy * 8 + (k >> 3);
        const r = px[k * 3]!, g = px[k * 3 + 1]!, bl = px[k * 3 + 2]!;
        let ink: boolean;
        if (opts.dither === "bayer" && len2 > 0) {
          const t = ((r - cp[0]) * vr + (g - cp[1]) * vg + (bl - cp[2]) * vb) / len2;
          ink = t > (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
        } else {
          ink = dist(r, g, bl, ci) < dist(r, g, bl, cp);
        }
        if (ink) scr[bitmapOffset(x, y)]! |= 0x80 >> (x & 7);
      }
    }
  }
  return scr;
}

export type FitMode = "stretch" | "contain" | "cover";

/** Rectángulo destino (en el lienzo 256×192) donde dibujar una imagen de w×h. */
export function fitRect(w: number, h: number, mode: FitMode): { x: number; y: number; w: number; h: number } {
  if (mode === "stretch") return { x: 0, y: 0, w: SCR_W, h: SCR_H };
  const s = mode === "contain" ? Math.min(SCR_W / w, SCR_H / h) : Math.max(SCR_W / w, SCR_H / h);
  const dw = Math.round(w * s), dh = Math.round(h * s);
  return { x: Math.floor((SCR_W - dw) / 2), y: Math.floor((SCR_H - dh) / 2), w: dw, h: dh };
}

// ---- Documento de la pestaña: {"v":1,"scr":"<base64 de los 6912 bytes>"} ----

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x2000) s += String.fromCharCode(...b.subarray(i, i + 0x2000));
  return btoa(s);
}

export function encodeScrDoc(scr: Uint8Array): string {
  if (scr.length !== SCR_SIZE) throw new Error(`una pantalla son ${SCR_SIZE} bytes`);
  return JSON.stringify({ v: 1, scr: toBase64(scr) });
}

/** Lanza con el motivo si el documento no es válido. */
export function decodeScrDoc(text: string): Uint8Array {
  let d: unknown;
  try { d = JSON.parse(text); } catch { throw new Error("el documento no es JSON válido"); }
  const o = d as { v?: unknown; scr?: unknown } | null;
  if (!o || o.v !== 1 || typeof o.scr !== "string") throw new Error("documento .scr desconocido (se esperaba v:1 y scr)");
  let bin: string;
  try { bin = atob(o.scr); } catch { throw new Error("el contenido de la pantalla no es base64"); }
  if (bin.length !== SCR_SIZE) throw new Error(`la pantalla tiene ${bin.length} bytes y deberían ser ${SCR_SIZE}`);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const scrResource: ResourceKind = {
  ext: "scr",
  label: "Pantalla",
  template: () => encodeScrDoc(emptyScr()),
  check(text) {
    try { decodeScrDoc(text); return null; } catch (e) { return (e as Error).message; }
  },
  toBin: decodeScrDoc,
};
