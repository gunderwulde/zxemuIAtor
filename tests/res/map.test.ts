// Mapas .map. Esperados escritos a mano.
import { describe, expect, it } from "vitest";
import {
  MAX_DIM, MAX_MARKS, cellBytes, columnBytes, fillRect, floodFill, mapInc, mapResource, markBytes, maxTileUsed,
  newMap, parseMapDoc, resizeMap, rle, serializeMap, setMarker, unrle,
} from "../../web/src/res/map";

const sample = () => {
  const m = newMap(4, 3, "set.tiles");
  m.data = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]];
  m.marks = [{ k: 7, c: 3, r: 2 }, { k: 1, c: 0, r: 0 }];
  return m;
};

describe("binarios", () => {
  it("filas: w·h bytes fila a fila; columnas: de arriba abajo, izquierda a derecha", () => {
    expect([...cellBytes(sample())]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect([...columnBytes(sample())]).toEqual([1, 5, 9, 2, 6, 10, 3, 7, 11, 4, 8, 12]);
  });
  it("marcadores: tipo, columna, fila en el orden del documento", () => {
    expect([...markBytes(sample())]).toEqual([7, 3, 2, 1, 0, 0]);
  });
  it("RLE de pares (cuenta, valor) con tramos de hasta 255", () => {
    expect([...rle(Uint8Array.from([5, 5, 5, 7]))]).toEqual([3, 5, 1, 7]);
    expect([...rle(new Uint8Array(300).fill(9))]).toEqual([255, 9, 45, 9]);
    expect([...rle(new Uint8Array(0))]).toEqual([]);
  });
  it("unrle deshace rle", () => {
    const b = Uint8Array.from([1, 1, 2, 2, 2, 3, 1, 1, 1, 1, 0, 0]);
    expect(unrle(rle(b))).toEqual(b);
    const big = new Uint8Array(1000).map((_, i) => (i % 97 < 60 ? 4 : i & 255));
    expect(unrle(rle(big))).toEqual(big);
  });
  it("las partes del recurso salen por su nombre", () => {
    const t = serializeMap(sample());
    expect(mapResource.toBin(t).length).toBe(12);
    expect([...mapResource.parts!.marks!(t)]).toEqual([7, 3, 2, 1, 0, 0]);
    expect(mapResource.parts!.cols!(t)[1]).toBe(5);
    expect([...mapResource.parts!.rle!(t)].length).toBe(24); // 12 celdas distintas: 12 pares
  });
});

describe("constantes (.inc)", () => {
  it("columnas, filas, celdas, bytes RLE y marcadores", () => {
    const inc = mapInc(sample(), "nivel-1");
    expect(inc).toContain("nivel_1_W\tequ 4");
    expect(inc).toContain("nivel_1_H\tequ 3");
    expect(inc).toContain("nivel_1_CELLS\tequ 12");
    expect(inc).toContain("nivel_1_RLE_BYTES\tequ 24");
    expect(inc).toContain("nivel_1_MARKS\tequ 2");
  });
});

describe("documento", () => {
  it("ida y vuelta", () => {
    expect(parseMapDoc(serializeMap(sample()))).toEqual(sample());
    expect(mapResource.check(mapResource.template())).toBeNull();
  });
  it("rechaza documentos inválidos con un motivo", () => {
    const bad = (mut: (d: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const d = JSON.parse(serializeMap(sample())); mut(d); return mapResource.check(JSON.stringify(d));
    };
    expect(mapResource.check("x")).toContain("JSON");
    expect(bad((d) => { d.v = 3; })).toContain("desconocido");
    expect(bad((d) => { d.w = 0; })).toContain("entre 1 y 255");
    expect(bad((d) => { d.h = MAX_DIM + 1; })).toContain("entre 1 y 255");
    expect(bad((d) => { d.tiles = 5; })).toContain("tiles");
    expect(bad((d) => { d.data.pop(); })).toContain("3 filas");
    expect(bad((d) => { d.data[1].pop(); })).toContain("fila 1");
    expect(bad((d) => { d.data[0][0] = 256; })).toContain("fila 0");
    expect(bad((d) => { d.marks[0].c = 4; })).toContain("fuera del mapa");
    expect(bad((d) => { d.marks[1] = { k: 0, c: 3, r: 2 }; })).toContain("ya hay otro");
    expect(bad((d) => { d.marks = Array.from({ length: MAX_MARKS + 1 }, (_, i) => ({ k: 0, c: i % 4, r: 0 })); })).toContain("máximo");
  });
});

describe("edición", () => {
  it("resizeMap conserva lo que cabe, rellena y descarta marcadores fuera", () => {
    const r = resizeMap(sample(), 2, 4, 99);
    expect(r.data).toEqual([[1, 2], [5, 6], [9, 10], [99, 99]]);
    expect(r.marks).toEqual([{ k: 1, c: 0, r: 0 }]);
    const g = resizeMap(sample(), 5, 3);
    expect(g.data[0]).toEqual([1, 2, 3, 4, 0]);
  });
  it("fillRect con las esquinas en cualquier orden y recortado al mapa", () => {
    const m = sample();
    fillRect(m, 2, 2, 1, 1, 0);
    expect(m.data).toEqual([[1, 2, 3, 4], [5, 0, 0, 8], [9, 0, 0, 12]]);
    fillRect(m, -5, -5, 0, 0, 77);
    expect(m.data[0]![0]).toBe(77);
    fillRect(m, 3, 2, 10, 10, 55);
    expect(m.data[2]![3]).toBe(55);
  });
  it("floodFill rellena la región conexa (4 vecinos) y no pasa en diagonal", () => {
    const m = newMap(4, 3);
    m.data = [[0, 0, 1, 0], [0, 1, 0, 0], [1, 0, 0, 0]];
    // La región de ceros de arriba a la izquierda: (0,0),(1,0),(0,1). Los ceros de (3,*) no se alcanzan
    // en diagonal desde ella.
    expect(floodFill(m, 0, 0, 5)).toBe(3);
    expect(m.data).toEqual([[5, 5, 1, 0], [5, 1, 0, 0], [1, 0, 0, 0]]);
    expect(floodFill(m, 0, 0, 5)).toBe(0);   // ya es 5
    expect(floodFill(m, 9, 9, 1)).toBe(0);   // fuera
    expect(floodFill(m, 3, 0, 8)).toBe(6);   // (3,0),(2,1),(3,1),(1,2),(2,2),(3,2)
  });
  it("setMarker sustituye en la misma celda, quita con null y respeta el máximo", () => {
    const m = sample();
    expect(setMarker(m, 3, 2, 9)).toBe(true);
    expect(m.marks).toHaveLength(2);
    expect(m.marks[0]!.k).toBe(9);
    setMarker(m, 3, 2, null);
    expect(m.marks).toEqual([{ k: 1, c: 0, r: 0 }]);
    setMarker(m, 2, 2, null);               // quitar donde no hay nada no falla
    const big = newMap(255, 2);
    for (let i = 0; i < MAX_MARKS; i++) expect(setMarker(big, i, 0, 1)).toBe(true);
    expect(setMarker(big, 0, 1, 1)).toBe(false);
    expect(setMarker(big, 5, 0, 2)).toBe(true); // sustituir sí
  });
  it("maxTileUsed", () => {
    expect(maxTileUsed(sample())).toBe(12);
    expect(maxTileUsed(newMap(2, 2))).toBe(0);
  });
});
