// OCR exacto de la pantalla del Spectrum usando la propia fuente de la ROM.
//
// Fuente (ROM): el juego de caracteres de la ROM 48K ocupa 0x3D00–0x3FFF, 8 bytes por
// carácter desde el código 0x20 (espacio) hasta 0x7F (©). Es la misma tabla que usa la
// ROM para imprimir (variable CHARS = 0x3C00, carácter c en CHARS + 8·c).
// Geometría de la pantalla: docs/zx48-hardware.md §3.

const FONT_ADDR = 0x3d00;

// Códigos del Spectrum que no coinciden con ASCII (manual del 48K, juego de caracteres).
const SPECIAL: Record<number, string> = { 0x5e: "↑", 0x60: "£", 0x7f: "©" };

function charFor(code: number): string {
  return SPECIAL[code] ?? String.fromCharCode(code);
}

function bitmapAddr(x: number, y: number): number {
  return 0x4000 | ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | x;
}

export interface ScreenTextOptions {
  /** Fuente a usar (768 bytes); por defecto la de `ram` en 0x3D00 o la de `rom`. */
  rom?: Uint8Array;
  /** Carácter para celdas que no casan con ningún glifo. */
  unknown?: string;
}

/**
 * Lee las 24×32 celdas y devuelve 24 líneas de 32 caracteres. Una celda casa con un
 * carácter si sus 8 bytes son idénticos al glifo o a su inverso (cursor, INVERSE 1,
 * FLASH en fase invertida). Celdas desconocidas → `unknown` ("?" por defecto).
 * `ram` puede ser la RAM plana de 64 KB (con la ROM en 0x0000) o una copia de
 * 0x4000–0x5AFF de 6912 bytes (entonces hace falta `rom`).
 */
export function screenLines(ram: Uint8Array, opts: ScreenTextOptions = {}): string[] {
  const fontSrc = opts.rom ?? ram;
  if (fontSrc.length < FONT_ADDR + 768) throw new Error("screenText: hace falta la ROM para la fuente");
  const font = fontSrc.subarray(FONT_ADDR, FONT_ADDR + 768);
  const scr = ram.length === 65536 ? ram : (() => {
    const m = new Uint8Array(65536);
    m.set(ram.subarray(0, 6912), 0x4000);
    return m;
  })();
  const glyphs = new Map<string, number>();
  for (let c = 0; c < 96; c++) {
    const g = [...font.subarray(c * 8, c * 8 + 8)];
    const key = g.join(",");
    const inv = g.map((b) => ~b & 0xff).join(",");
    if (!glyphs.has(key)) glyphs.set(key, 0x20 + c);
    if (!glyphs.has(inv)) glyphs.set(inv, 0x20 + c);
  }
  const unknown = opts.unknown ?? "?";
  const lines: string[] = [];
  for (let row = 0; row < 24; row++) {
    let s = "";
    for (let col = 0; col < 32; col++) {
      const cell: number[] = [];
      for (let k = 0; k < 8; k++) cell.push(scr[bitmapAddr(col, row * 8 + k)]!);
      const code = glyphs.get(cell.join(","));
      s += code === undefined ? unknown : charFor(code);
    }
    lines.push(s);
  }
  return lines;
}

/** Las 24 líneas unidas con "\n". */
export function screenText(ram: Uint8Array, opts: ScreenTextOptions = {}): string {
  return screenLines(ram, opts).join("\n");
}
