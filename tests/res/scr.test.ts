// Pantallas .scr. Esperados escritos a mano a partir del hardware (docs/zx48-hardware.md §3):
// direcciones del bitmap por tercios, atributo = FLASH|BRIGHT|PAPER<<3|INK.
import { describe, expect, it } from "vitest";
import {
  ATTR_SIZE, BITMAP_SIZE, PALETTE, SCR_SIZE, bitmapOffset, convertRgba, decodeScrDoc, emptyScr,
  encodeScrDoc, fitRect, scrResource, scrToRgba,
} from "../../web/src/res/scr";

/** Imagen RGBA 256×192 rellena con f(x, y) → [r, g, b] (alfa 255). */
function image(f: (x: number, y: number) => readonly [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(256 * 192 * 4);
  for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) {
    const c = f(x, y), o = (y * 256 + x) * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return d;
}
const NONE = { dither: "none" as const };

describe("layout de SCREEN$", () => {
  it("direcciones del bitmap conocidas (0x4000 + …)", () => {
    expect(bitmapOffset(0, 0)).toBe(0x0000);
    expect(bitmapOffset(255, 0)).toBe(0x001f);
    expect(bitmapOffset(0, 1)).toBe(0x0100);   // siguiente línea de pixel: +256
    expect(bitmapOffset(0, 8)).toBe(0x0020);   // siguiente fila de caracteres: +32
    expect(bitmapOffset(0, 64)).toBe(0x0800);  // segundo tercio
    expect(bitmapOffset(0, 128)).toBe(0x1000); // tercer tercio
    expect(bitmapOffset(255, 191)).toBe(0x17ff);
  });
  it("tamaños", () => {
    expect([BITMAP_SIZE, ATTR_SIZE, SCR_SIZE]).toEqual([6144, 768, 6912]);
    const e = emptyScr();
    expect(e.length).toBe(6912);
    expect([e[0], e[6144], e[6911]]).toEqual([0, 0x38, 0x38]);
  });
  it("la paleta es la del núcleo: 0xD7 normal, 0xFF brillante, negro igual", () => {
    expect(PALETTE[0]).toEqual([0, 0, 0]);
    expect(PALETTE[2]).toEqual([0xd7, 0, 0]);
    expect(PALETTE[5]).toEqual([0, 0xd7, 0xd7]);
    expect(PALETTE[8]).toEqual([0, 0, 0]);
    expect(PALETTE[15]).toEqual([255, 255, 255]);
  });
  it("scrToRgba pinta tinta/papel y brillo por celda", () => {
    const s = emptyScr();
    s[0] = 0x80;                       // píxel (0,0) en tinta
    s[BITMAP_SIZE] = 0x40 | (1 << 3) | 2; // brillo, papel azul, tinta roja
    const rgba = scrToRgba(s);
    expect([...rgba.slice(0, 4)]).toEqual([255, 0, 0, 255]);        // tinta roja brillante
    expect([...rgba.slice(4, 8)]).toEqual([0, 0, 255, 255]);        // papel azul brillante
    expect([...rgba.slice(8 * 4, 8 * 4 + 4)]).toEqual([0xd7, 0xd7, 0xd7, 255]); // celda 1: papel blanco normal
  });
});

describe("convertRgba", () => {
  it("negro a la izquierda y blanco a la derecha de cada celda: 0x0F y atributo brillante 0x47", () => {
    const s = convertRgba(image((x) => (x & 7) < 4 ? [0, 0, 0] : [255, 255, 255]), NONE);
    expect(s.slice(0, BITMAP_SIZE).every((b) => b === 0x0f)).toBe(true);
    expect(s.slice(BITMAP_SIZE).every((b) => b === 0x47)).toBe(true);
  });
  it("color liso: todo papel (bitmap a 0) con el atributo de ese color", () => {
    const s = convertRgba(image(() => [255, 0, 0]), NONE);
    expect(s.slice(0, BITMAP_SIZE).every((b) => b === 0)).toBe(true);
    expect(s[BITMAP_SIZE]).toBe(0x40 | (2 << 3)); // brillo, papel rojo, tinta negra
  });
  it("un píxel distinto va a su sitio por el layout (x=9, y=9 → byte 0x0120+1)", () => {
    const s = convertRgba(image((x, y) => x === 9 && y === 9 ? [255, 255, 255] : [0, 0, 0]), NONE);
    expect(bitmapOffset(9, 9)).toBe(0x0121);
    expect(s[0x0121]).toBe(0x40); // bit 6 = x&7 = 1
    expect(s.slice(0, BITMAP_SIZE).filter((b) => b).length).toBe(1);
    expect(s[BITMAP_SIZE + 32 + 1]! & 7).toBe(7); // celda (1,1): tinta blanca; papel negro
  });
  it("tramado Bayer 4×4: rampa negro→blanco normal, filas 0 y 1 calculadas a mano", () => {
    // v_k = round(k·215/7) = 0,31,61,92,123,154,184,215 → t = v/215 sobre el par negro/blanco.
    // Umbrales (B+0.5)/16: fila 0 = .031 .531 .156 .656; fila 1 = .781 .281 .906 .406.
    // Fila 0: tinta en k = 2,4,5,6,7 → 0b00101111. Fila 1: k = 3,5,7 → 0b00010101.
    const ramp = image((x) => { const v = Math.round((x & 7) * 215 / 7); return [v, v, v]; });
    const s = convertRgba(ramp, { dither: "bayer" });
    expect(s[bitmapOffset(0, 0)]).toBe(0x2f);
    expect(s[bitmapOffset(0, 1)]).toBe(0x15);
    expect(s[BITMAP_SIZE]).toBe(7); // papel negro, tinta blanca (a igualdad gana el primero en orden)
  });
  it("sin tramado la misma rampa se corta en la mitad: 0x0F", () => {
    const ramp = image((x) => { const v = Math.round((x & 7) * 215 / 7); return [v, v, v]; });
    const s = convertRgba(ramp, NONE);
    expect(s[bitmapOffset(0, 0)]).toBe(0x0f);
    expect(s[BITMAP_SIZE]).toBe(7); // papel negro, tinta blanca (gana el primero en orden con 4 tintas)
  });
  it("determinista y compone la transparencia sobre negro", () => {
    const rgba = image(() => [255, 255, 255]);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 0;
    const a = convertRgba(rgba, NONE), b = convertRgba(rgba, NONE);
    expect(a).toEqual(b);
    expect(a.slice(0, BITMAP_SIZE).every((v) => v === 0)).toBe(true);
    expect(a[BITMAP_SIZE]! & 0x38).toBe(0); // papel negro
  });
  it("rechaza tamaños que no son 256×192", () => {
    expect(() => convertRgba(new Uint8ClampedArray(16), NONE)).toThrow();
  });
});

describe("fitRect", () => {
  it("estirar, ajustar con barras y recortar", () => {
    expect(fitRect(100, 100, "stretch")).toEqual({ x: 0, y: 0, w: 256, h: 192 });
    expect(fitRect(512, 192, "contain")).toEqual({ x: 0, y: 48, w: 256, h: 96 });
    expect(fitRect(256, 384, "contain")).toEqual({ x: 64, y: 0, w: 128, h: 192 });
    expect(fitRect(512, 192, "cover")).toEqual({ x: -128, y: 0, w: 512, h: 192 });
  });
});

describe("documento .scr", () => {
  it("ida y vuelta y plantilla válida", () => {
    const s = emptyScr(); s[100] = 0xaa; s[6911] = 0x07;
    expect(decodeScrDoc(encodeScrDoc(s))).toEqual(s);
    expect(scrResource.check(scrResource.template())).toBeNull();
    expect(scrResource.toBin(scrResource.template())).toEqual(emptyScr());
  });
  it("mensajes para documentos inválidos", () => {
    expect(scrResource.check("basura")).toContain("JSON");
    expect(scrResource.check('{"v":2}')).toContain("desconocido");
    expect(scrResource.check('{"v":1,"scr":"@@@"}')).toContain("base64");
    expect(scrResource.check('{"v":1,"scr":"AAAA"}')).toContain("3 bytes");
  });
});
