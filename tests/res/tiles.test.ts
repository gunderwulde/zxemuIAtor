// Conjuntos de tiles .tiles. Esperados escritos a mano: layout compatible con zxgen
// (16×16 = 16 filas × 2 bytes, 4 atributos TL/TR/BL/BR) y constantes de .inc.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAGS, MAX_TILES, attrBytes, emptyTile, flipH, flipHAttrs, flipV, flipVAttrs, gfxBytes, invertPix,
  newTileSet, parseTileDoc, propBytes, rotate90, rotate90Attrs, serializeTileSet, setPixel, shiftPix,
  tilesFromImage, tilesInc, tilesResource, valBytes, type TileSet,
} from "../../web/src/res/tiles";

const set16 = (): TileSet => {
  const ts = newTileSet(16);
  const t = ts.tiles[0]!;
  t.pix[0] = "X" + ".".repeat(15);            // 0x80 0x00
  t.pix[1] = "X".repeat(16);                  // 0xFF 0xFF
  t.pix[2] = ".......XX.......";              // 0x01 0x80
  t.pix[15] = ".".repeat(15) + "X";           // 0x00 0x01
  t.atr = [0x07, 0x46, 0x10, 0x00];
  t.props = 0b101; t.val = 200; t.name = "WALL";
  ts.tiles.push(emptyTile(16, 0x45));
  ts.tiles[1]!.props = 2;
  return ts;
};

describe("binarios", () => {
  it("16×16: 32 bytes por tile, fila a fila, alto primero", () => {
    const g = gfxBytes(set16());
    expect(g.length).toBe(64);
    expect([...g.slice(0, 6)]).toEqual([0x80, 0x00, 0xff, 0xff, 0x01, 0x80]);
    expect([g[30], g[31]]).toEqual([0x00, 0x01]);
    expect([...g.slice(32, 64)].every((b) => b === 0)).toBe(true);
  });
  it("8×8: 8 bytes por tile y un atributo", () => {
    const ts = newTileSet(8);
    ts.tiles[0]!.pix[3] = "X.X.X.X.";
    ts.tiles[0]!.atr = [0x42];
    expect([...gfxBytes(ts)]).toEqual([0, 0, 0, 0xaa, 0, 0, 0, 0]);
    expect([...attrBytes(ts)]).toEqual([0x42]);
  });
  it("atributos TL, TR, BL, BR; propiedades y valores, un byte por tile", () => {
    const ts = set16();
    expect([...attrBytes(ts)]).toEqual([0x07, 0x46, 0x10, 0x00, 0x45, 0x45, 0x45, 0x45]);
    expect([...propBytes(ts)]).toEqual([5, 2]);
    expect([...valBytes(ts)]).toEqual([200, 0]);
  });
  it("las partes del recurso salen por su nombre", () => {
    const text = serializeTileSet(set16());
    expect(tilesResource.toBin(text).length).toBe(64);
    expect([...tilesResource.parts!.props!(text)]).toEqual([5, 2]);
    expect(tilesResource.parts!.attr!(text).length).toBe(8);
  });
});

describe("constantes (.inc)", () => {
  it("cuenta, tamaño, banderas por bit y nombres de tile", () => {
    const inc = tilesInc(set16(), "mi-set");
    expect(inc).toContain("mi_set_COUNT\tequ 2\t");
    expect(inc).toContain("mi_set_SIZE\tequ 16");
    expect(inc).toContain("mi_set_GFX_BYTES\tequ 32");
    expect(inc).toContain("mi_set_ATTRS\tequ 4");
    expect(inc).toContain("mi_set_SOLID\tequ 1");
    expect(inc).toContain("mi_set_HURTS\tequ 4");
    expect(inc).toContain("mi_set_SPECIAL\tequ 128");
    expect(inc).toContain("mi_set_T_WALL\tequ 0");
    expect(inc.match(/_T_/g)).toHaveLength(1); // sólo el tile con nombre
  });
});

describe("documento", () => {
  it("ida y vuelta", () => {
    const ts = set16();
    expect(parseTileDoc(serializeTileSet(ts))).toEqual(ts);
    expect(tilesResource.check(tilesResource.template())).toBeNull();
  });
  it("rechaza documentos inválidos con un motivo", () => {
    const bad = (mut: (d: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const d = JSON.parse(serializeTileSet(set16())); mut(d); return tilesResource.check(JSON.stringify(d));
    };
    expect(tilesResource.check("x")).toContain("JSON");
    expect(bad((d) => { d.v = 2; })).toContain("desconocido");
    expect(bad((d) => { d.size = 12; })).toContain("8 o 16");
    expect(bad((d) => { d.flags.pop(); })).toContain("8 nombres");
    expect(bad((d) => { d.flags[0] = "1A"; })).toContain("bandera");
    expect(bad((d) => { d.flags[1] = "solid"; })).toContain("repetido");
    expect(bad((d) => { d.tiles = []; })).toContain("al menos");
    expect(bad((d) => { d.tiles[0].pix.pop(); })).toContain("16 filas");
    expect(bad((d) => { d.tiles[0].pix[0] = "X?" + ".".repeat(14); })).toContain("«X» o «.»");
    expect(bad((d) => { d.tiles[0].atr = [1, 2]; })).toContain("4 atributos");
    expect(bad((d) => { d.tiles[0].atr[0] = 128; })).toContain("entre 0 y 127");
    expect(bad((d) => { d.tiles[0].props = 256; })).toContain("props");
    expect(bad((d) => { d.tiles[1].name = "WALL"; })).toContain("repetido");
    expect(bad((d) => { d.tiles[0].name = "a b"; })).toContain("nombre no válido");
    expect(bad((d) => { d.tiles = Array(MAX_TILES + 1).fill(d.tiles[1]); })).toContain("máximo");
  });
  it("las banderas por defecto son las ocho esperadas", () => {
    expect(DEFAULT_FLAGS).toHaveLength(8);
    expect(DEFAULT_FLAGS[0]).toBe("SOLID");
  });
});

describe("edición de píxeles", () => {
  const p = ["X...", "XX..", "....", "...X"];
  it("setPixel y límites", () => {
    expect(setPixel(p, 3, 0, true)[0]).toBe("X..X");
    expect(setPixel(p, 0, 0, false)[0]).toBe("....");
    expect(setPixel(p, 9, 9, true)).toEqual(p);
  });
  it("reflejos, inversión y desplazamiento", () => {
    expect(flipH(p)).toEqual(["...X", "..XX", "....", "X..."]);
    expect(flipV(p)).toEqual(["...X", "....", "XX..", "X..."]);
    expect(invertPix(["X."])).toEqual([".X"]);
    expect(shiftPix(p, 1, 0)).toEqual([".X..", ".XX.", "....", "X..."]);
    expect(shiftPix(p, 0, -1)).toEqual(["XX..", "....", "...X", "X..."]);
    expect(shiftPix(p, 4, 4)).toEqual(p);
  });
  it("giro a la derecha: la columna izquierda (de abajo arriba) pasa a ser la fila de arriba", () => {
    // Columna 0 de p, de abajo a arriba: ".", ".", "X", "X"  → fila 0 = "..XX".
    expect(rotate90(p)[0]).toBe("..XX");
    // La esquina de abajo a la derecha (3,3) pasa a la de abajo a la izquierda (0,3).
    expect(rotate90(p)[3]).toBe("X...");
    // Cuatro giros devuelven el original.
    expect(rotate90(rotate90(rotate90(rotate90(p))))).toEqual(p);
  });
  it("los atributos de los cuatro cuadros acompañan a reflejos y giros", () => {
    const a = [1, 2, 3, 4]; // TL TR BL BR
    expect(flipHAttrs(a)).toEqual([2, 1, 4, 3]);
    expect(flipVAttrs(a)).toEqual([3, 4, 1, 2]);
    expect(rotate90Attrs(a)).toEqual([3, 1, 4, 2]);
    expect(flipHAttrs([9])).toEqual([9]);
  });
});

describe("tilesFromImage", () => {
  function image(w: number, h: number, f: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = f(x, y), o = (y * w + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    return d;
  }
  it("corta en tiles y convierte; el atributo de cada cuadro de 8×8 va a su sitio", () => {
    // 32×16: dos tiles de 16×16. Tile 0: cuadrante inferior derecho blanco brillante sobre negro.
    // Tile 1: todo rojo brillante.
    const img = image(32, 16, (x, y) => x >= 16 ? [255, 0, 0] : (x >= 8 && y >= 8 ? [255, 255, 255] : [0, 0, 0]));
    const t = tilesFromImage(img, 32, 16, 16, { dither: "none" });
    expect(t).toHaveLength(2);
    // Una celda lisa va toda a papel: el bitmap del tile 0 queda vacío y el color va en el atributo.
    expect(t[0]!.pix.every((r) => !r.includes("X"))).toBe(true);
    expect(t[0]!.atr[3]).toBe(0x40 | (7 << 3)); // brillo, papel blanco
    expect(t[0]!.atr[0]! & 0x38).toBe(0);        // papel negro
    expect(t[1]!.atr.every((a) => a === (0x40 | (2 << 3)))).toBe(true);
  });
  it("tiles de 8×8 y recorte de lo que sobra", () => {
    const img = image(20, 9, () => [0, 0, 0]);
    expect(tilesFromImage(img, 20, 9, 8, { dither: "none" })).toHaveLength(2);
    expect(() => tilesFromImage(img, 20, 9, 16, { dither: "none" })).toThrow(/menor/);
  });
  it("no pasa de MAX_TILES", () => {
    const w = 8 * 20, h = 8 * 20; // 400 tiles de 8×8
    const t = tilesFromImage(image(w, h, () => [0, 0, 0]), w, h, 8, { dither: "none" });
    expect(t).toHaveLength(MAX_TILES);
  });
});
