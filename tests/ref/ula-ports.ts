// Modelo REF de la lectura del puerto 0xFE (docs/zx48-hardware.md §6).
//
//  - Bits 0–4: teclado, 0 = pulsada. Cada bit a 0 del byte alto del puerto selecciona
//    una semifila (bit 8 → 0xFEFE … bit 15 → 0x7FFE).
//  - Bit 6: EAR. Sin señal de cinta, Issue 3 = último bit 4 escrito; Issue 2 = 0 sólo
//    si los bits 3 y 4 escritos son ambos 0. Contrastado con Fuse
//    (peripherals/ula.c ula_write: ula_default_value = b & EAR ? 0xff : 0xbf en Issue 3;
//    b & (EAR|MIC) ? 0xff : 0xbf en Issue 2).
//  - Bits 5 y 7: 1.
//  - Cualquier puerto par lo decodifica la ULA (Fuse spec48_port_from_ula: !(port & 1)).
//
// Ghosting: docs §6 pide modelar la matriz, no una tabla. Modelo eléctrico: las 8
// líneas de dirección (semifilas) y las 5 de datos (columnas) son nodos; cada tecla
// pulsada es un conductor entre su semifila y su columna. Las semifilas seleccionadas
// están a 0; una columna lee 0 si está conectada (por cualquier camino de teclas
// pulsadas) a alguna semifila seleccionada. Con tres esquinas de un rectángulo
// pulsadas aparece la cuarta.
//
// Nota: Fuse NO modela el ghosting (keyboard_read hace AND de semifilas); aquí manda
// docs §6.

export const ROWS = 8;
export const COLS = 5;

/** Teclas pulsadas como pares [row, bit] (row 0..7 = semifila de 0xFEFE … 0x7FFE). */
export type KeySet = ReadonlyArray<readonly [number, number]>;

/** Columnas (bits 0–4) que leen 0 al seleccionar las semifilas de `port >> 8`. */
export function keyboardBits(port: number, keys: KeySet): number {
  const high = (port >> 8) & 0xff;
  // Nodos: 0..7 semifilas, 8..12 columnas. Búsqueda en anchura desde las semifilas
  // seleccionadas por las aristas de las teclas pulsadas.
  const seen = new Array<boolean>(ROWS + COLS).fill(false);
  const queue: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    if (!((high >> r) & 1)) {
      seen[r] = true;
      queue.push(r);
    }
  }
  while (queue.length) {
    const n = queue.shift()!;
    for (const [r, b] of keys) {
      const a = r;
      const c = ROWS + b;
      const other = n === a ? c : n === c ? a : -1;
      if (other >= 0 && !seen[other]) {
        seen[other] = true;
        queue.push(other);
      }
    }
  }
  let v = 0x1f;
  for (let b = 0; b < COLS; b++) if (seen[ROWS + b]) v &= ~(1 << b);
  return v;
}

/** Bit 6 (EAR in) sin cinta, en función del último byte escrito en un puerto par. */
export function earBit(lastFE: number, issue: 2 | 3): number {
  if (issue === 3) return (lastFE >> 4) & 1;
  return (lastFE & 0x18) !== 0 ? 1 : 0;
}

/** Byte leído de un puerto par de la ULA. */
export function readULA(port: number, keys: KeySet, lastFE: number, issue: 2 | 3): number {
  if (port & 1) throw new Error("readULA: puerto impar (no es de la ULA)");
  return keyboardBits(port, keys) | 0xa0 | (earBit(lastFE, issue) << 6);
}
