// Pantalla: ImageData construido directamente sobre el framebuffer RGBA del wasm (sin
// copias en JS; putImageData es la única copia, hacia el canvas). El escalado lo hace el
// CSS con image-rendering: pixelated.
import { FB_HEIGHT, FB_WIDTH } from "./core";

export type Scale = "fit" | 1 | 2 | 3;

export function parseScale(s: string | null): Scale {
  return s === "1" || s === "2" || s === "3" ? (Number(s) as 1 | 2 | 3) : "fit";
}

export class Display {
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;

  constructor(private canvas: HTMLCanvasElement, framebuffer: Uint8ClampedArray<ArrayBuffer>) {
    canvas.width = FB_WIDTH;
    canvas.height = FB_HEIGHT;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.image = new ImageData(framebuffer, FB_WIDTH, FB_HEIGHT);
  }

  draw(): void { this.ctx.putImageData(this.image, 0, 0); }

  setScale(s: Scale): void {
    const c = this.canvas;
    c.dataset.scale = String(s);
    c.style.width = s === "fit" ? "" : `${FB_WIDTH * s}px`;
    c.style.height = s === "fit" ? "" : `${FB_HEIGHT * s}px`;
  }
}
