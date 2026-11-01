// Renderizador REF ingenuo de la ULA 48K: evalúa cada grupo de 8 píxeles en su
// T-state con el estado de la memoria y del borde en ese instante.
//
// Fuentes (no se ha mirado core/src/video.c):
//  - Geometría y paleta: docs/zx48-hardware.md §3 y §7.
//  - Instante de muestreo: docs §7 ("el byte 16384 se dibuja 14 336 T después de /INT";
//    "un OUT que termina en 14339–14342 cambia el borde en la posición del byte 16384")
//    y Fuse (display_dirty.c display_get_beam_position/display_update_critical,
//    display_border.c push_border_change, machine.c line_times[0] = 14336 − 24·224 − 16).
//
// Regla resultante (la misma para pantalla y borde): el grupo de 8 píxeles que la ULA
// empieza a dibujar en el T `g` muestra el estado tras aplicar TODOS los eventos con
// `t ≤ g + 3`. Es decir, cuatro T consecutivos (g..g+3) de escritura producen la misma
// imagen y la escritura en g+4 ya llega tarde para ese grupo.
//
// Convención del T de cada evento (la del bus de Fuse, ver tests/ref/contention.ts):
//  - escritura de memoria: T al FINAL del ciclo de escritura (tras contención + 3 T);
//    es también el T en el que zx_poke escribe si se llama con zx_tstate() == t.
//  - OUT al borde: T en que la ULA ve el dato = inicio del ciclo de E/S + 1 + retardo
//    de contención de la parte "early" (CycleTiming.dataT).

export const FB_WIDTH = 352; // DOC §7: 48 + 256 + 48
export const FB_HEIGHT = 296; // DOC §7: 48 + 192 + 56
export const BORDER_LEFT = 48; // DOC §7
export const BORDER_TOP = 48; // DOC §7
export const SCREEN_T0 = 14336; // DOC §7: T en que se empieza a dibujar el byte 16384
export const TSTATES_PER_LINE = 224; // DOC §1
export const SAMPLE_LAG = 3; // Fuse: eventos con t ≤ g + 3 ya se ven en el grupo g

/** DOC §3: índice GRB 0..7, normal = 0xD7, BRIGHT = 0xFF, negro brillante = negro. */
export function paletteRGB(index: number): [number, number, number] {
  const bright = (index & 8) !== 0;
  const v = bright ? 0xff : 0xd7;
  const g = index & 4 ? v : 0;
  const r = index & 2 ? v : 0;
  const b = index & 1 ? v : 0;
  return [r, g, b];
}

/** DOC §3: dirección del byte de bitmap de la línea y (0..191), columna x (0..31). */
export function bitmapAddr(x: number, y: number): number {
  return 0x4000 | ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | x;
}

/** DOC §3. */
export function attrAddr(x: number, y: number): number {
  return 0x5800 + (y >> 3) * 32 + x;
}

/** Inversa de bitmapAddr: (x, y) del byte de bitmap `addr` (0x4000..0x57FF). */
export function bitmapXY(addr: number): { x: number; y: number } {
  const o = addr - 0x4000;
  const x = o & 31;
  const y = ((o >> 11) & 3) * 64 + ((o >> 5) & 7) * 8 + ((o >> 8) & 7);
  return { x, y };
}

/**
 * T en que la ULA empieza a dibujar el grupo de 8 píxeles (gx 0..43, fy 0..295) del
 * framebuffer. Lineal en todo el área visible: Fuse lo define así para las 240 líneas
 * que muestra (line_times[y] = line_times[0] + 224·y, columna = 4 T); aquí se extiende
 * a las 48 líneas superiores y 56 inferiores de nuestro framebuffer.
 */
export function groupT(gx: number, fy: number): number {
  return SCREEN_T0 + (fy - BORDER_TOP) * TSTATES_PER_LINE + (gx - BORDER_LEFT / 8) * 4;
}

export type VideoEvent =
  | { t: number; kind: "mem"; addr: number; value: number }
  | { t: number; kind: "border"; value: number };

export interface FrameInput {
  /** Memoria 0x4000–0x5AFF al empezar el frame (índice = addr − 0x4000) o RAM de 64 KB. */
  screen: Uint8Array;
  /** Color de borde (0..7) al empezar el frame. */
  border: number;
  /** Fase de FLASH: true = tinta y papel intercambiados en las celdas con bit 7. */
  flashInverted: boolean;
  /** Eventos del frame, en cualquier orden. */
  events: VideoEvent[];
}

/** DOC §3 / Fuse display_render.c: frames 0–15 normal, 16–31 invertido (periodo 32). */
export function flashInvertedForFrame(frame: number): boolean {
  return ((frame >> 4) & 1) === 1;
}

/**
 * Renderiza un frame completo a RGBA 352×296 (Uint8Array de 352·296·4). Algoritmo
 * obvio: para cada grupo calcula su T, reconstruye el estado en g+3 aplicando los
 * eventos en orden y pinta los 8 píxeles.
 */
export function renderFrame(input: FrameInput): Uint8Array {
  const out = new Uint8Array(FB_WIDTH * FB_HEIGHT * 4);
  const screen = new Uint8Array(0x1b00);
  if (input.screen.length === 65536) screen.set(input.screen.subarray(0x4000, 0x5b00));
  else screen.set(input.screen.subarray(0, 0x1b00));
  let border = input.border & 7;
  // Orden estable por t (a igual t, el orden de la lista).
  const ev = input.events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
  let next = 0;

  // Los grupos se recorren en orden creciente de T (fila a fila, de izquierda a
  // derecha), así que basta con ir aplicando eventos hasta g + 3.
  for (let fy = 0; fy < FB_HEIGHT; fy++) {
    for (let gx = 0; gx < FB_WIDTH / 8; gx++) {
      const sample = groupT(gx, fy) + SAMPLE_LAG;
      while (next < ev.length && ev[next]!.t <= sample) {
        const e = ev[next++]!;
        if (e.kind === "border") border = e.value & 7;
        else if (e.addr >= 0x4000 && e.addr < 0x5b00) screen[e.addr - 0x4000] = e.value & 0xff;
      }
      const y = fy - BORDER_TOP;
      const x = gx - BORDER_LEFT / 8;
      let colors: number[];
      if (y < 0 || y >= 192 || x < 0 || x >= 32) {
        colors = new Array<number>(8).fill(border);
      } else {
        let pix = screen[bitmapAddr(x, y) - 0x4000]!;
        const att = screen[attrAddr(x, y) - 0x4000]!;
        if (att & 0x80 && input.flashInverted) pix = ~pix & 0xff;
        const bright = (att >> 3) & 8;
        const ink = (att & 7) | bright;
        const paper = ((att >> 3) & 7) | bright;
        colors = [];
        for (let b = 0; b < 8; b++) colors.push(pix & (0x80 >> b) ? ink : paper);
      }
      for (let b = 0; b < 8; b++) {
        const [r, g, bl] = paletteRGB(colors[b]!);
        const o = (fy * FB_WIDTH + gx * 8 + b) * 4;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = bl;
        out[o + 3] = 0xff;
      }
    }
  }
  return out;
}

/** Primer píxel distinto entre dos framebuffers RGBA, o null si son idénticos. */
export function firstFbDiff(a: Uint8Array, b: Uint8Array): string | null {
  if (a.length !== b.length) return `longitudes distintas ${a.length} != ${b.length}`;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
      const p = i / 4;
      const fx = p % FB_WIDTH;
      const fy = Math.floor(p / FB_WIDTH);
      const hex = (u: Uint8Array) => [...u.subarray(i, i + 4)].map((v) => v.toString(16).padStart(2, "0")).join("");
      return `píxel (${fx},${fy}) [grupo ${fx >> 3}, T ${groupT(fx >> 3, fy)}]: obtenido ${hex(a)} esperado ${hex(b)}`;
    }
  }
  return null;
}
