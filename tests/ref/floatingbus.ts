// Modelo REF del bus flotante del 48K (docs/zx48-hardware.md §8).
//
// Fuente del patrón: docs §8 (bitmap, atributo, bitmap+1, atributo+1 y 4 T de 0xFF
// por grupo de 8 T; 0xFF fuera de pantalla). Fuente de los T exactos: Fuse,
// spectrum.c spectrum_unattached_port():
//   - line_times[24] = 14320 (inicio de la línea 0 de pantalla en la cuenta de Fuse)
//   - tstates_through_line = t − 14320 − 224·línea + 8; ventana activa 24..151
//   - (tstates_through_line % 8): 2 → bitmap col, 3 → attr col, 4 → bitmap col+1,
//     5 → attr col+1, resto 0xFF; col = ((ttl − 24) / 8)·2
//   ⇒ el primer byte (bitmap de la columna 0, línea 0) se devuelve en T 14338
//     (comentario literal de Fuse: "first byte being returned at 14338 (48K)").
// `t` es el T en que se muestrea el bus de datos durante el IN (CycleTiming.dataT de
// tests/ref/contention.ts: 1 T antes del final del ciclo de E/S).

import { attrAddr, bitmapAddr } from "./video";

export const FLOATING_FIRST = 14338; // Fuse spectrum.c

/**
 * Qué está leyendo la ULA en el T `t`: dirección (bitmap o atributo) o null si el bus
 * está libre (0xFF).
 */
export function floatingSource(t: number): { addr: number; kind: "bitmap" | "attr" } | null {
  const rel = t - (FLOATING_FIRST - 2); // 0 = inicio del primer grupo de 8 T de la línea 0
  if (rel < 0) return null;
  const line = Math.floor(rel / 224);
  if (line >= 192) return null;
  const k = rel - line * 224;
  if (k >= 128) return null;
  const group = Math.floor(k / 8);
  const col = group * 2;
  switch (k % 8) {
    case 2: return { addr: bitmapAddr(col, line), kind: "bitmap" };
    case 3: return { addr: attrAddr(col, line), kind: "attr" };
    case 4: return { addr: bitmapAddr(col + 1, line), kind: "bitmap" };
    case 5: return { addr: attrAddr(col + 1, line), kind: "attr" };
    default: return null;
  }
}

/** Valor del bus flotante en el T `t` con la RAM `ram` (64 KB). */
export function floatingBus(t: number, ram: Uint8Array): number {
  const s = floatingSource(t);
  return s ? ram[s.addr]! : 0xff;
}
