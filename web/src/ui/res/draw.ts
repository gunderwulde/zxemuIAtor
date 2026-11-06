// Dibujo compartido por los editores de recursos (DOM).
import { PALETTE } from "../../res/scr";
import type { Tile, TileSize } from "../../res/tiles";

export const rgb = (c: readonly [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(text: string, title: string, onclick: () => void): HTMLButtonElement {
  const b = el("button", undefined, text);
  b.type = "button";
  b.title = title;
  b.onclick = onclick;
  return b;
}

export function field(label: string, input: HTMLElement): HTMLLabelElement {
  const l = el("label", "res-field");
  l.append(el("span", undefined, label), input);
  return l;
}

/** Dibuja un tile (con sus colores por cuadro) en un contexto, a escala `s` píxeles por píxel. */
export function paintTile(ctx: CanvasRenderingContext2D, t: Tile, size: TileSize, s: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = t.atr[size === 16 ? (y >> 3) * 2 + (x >> 3) : 0]!;
      const br = (a >> 6) & 1;
      ctx.fillStyle = rgb(PALETTE[(t.pix[y]![x] === "X" ? a & 7 : (a >> 3) & 7) + 8 * br]!);
      ctx.fillRect(x * s, y * s, s, s);
    }
  }
}

/** Tile a 1:1 en un lienzo propio (para pintarlo muchas veces con drawImage). */
export function tileCanvas(t: Tile, size: TileSize): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  paintTile(c.getContext("2d")!, t, size, 1);
  return c;
}
