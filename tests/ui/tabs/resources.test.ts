// Recursos como pestañas: nombres válidos, INCBIN desde el ensamblador y persistencia.
// El tipo "fake" se registra aquí: el valor esperado (bytes) está escrito a mano.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assemble } from "../../../web/src/asm";
import { registerResource, resourceKindOf, unregisterResource } from "../../../web/src/res/registry";
import { emptyScr, encodeScrDoc, scrResource } from "../../../web/src/res/scr";
import { mapResource, newMap, serializeMap } from "../../../web/src/res/map";
import { newTileSet, serializeTileSet, tilesResource } from "../../../web/src/res/tiles";
import { TabsModel, type Prefs } from "../../../web/src/ui/tabs/model";
import { asmOptsFor } from "../../../web/src/ui/tabs/build";

beforeAll(() => { registerResource(scrResource); registerResource(tilesResource); registerResource(mapResource); registerResource({
  ext: "fake", label: "Fake",
  template: () => "[]",
  check: (t) => (/^\[[\d,]*\]$/.test(t) ? null : "no es una lista de bytes"),
  toBin: (t) => Uint8Array.from(JSON.parse(t) as number[]),
}); });
afterAll(() => { unregisterResource("fake"); unregisterResource("scr"); unregisterResource("tiles"); unregisterResource("map"); });

const prefs = (): Prefs => { const d = new Map<string, string>(); return { get: (k) => d.get(k) ?? null, set: (k, v) => { d.set(k, v); } }; };

describe("pestañas de recurso", () => {
  it("el nombre vale con extensión de recurso y se reconoce sin distinguir mayúsculas", () => {
    const m = new TabsModel();
    expect(m.checkName("a.fake")).toBeNull();
    expect(m.checkName("a.FAKE")).toBeNull();
    expect(resourceKindOf("a.Fake")?.ext).toBe("fake");
    expect(m.checkName("a.zzz")).toContain(".fake");
  });

  it("INCBIN de una pestaña incluye sus bytes y avisa si el documento es inválido", () => {
    const m = TabsModel.initial("", "");
    m.add("gfx.fake", "[7,8,9]");
    const ok = assemble(' org 8000h\n incbin "gfx.fake"\n', asmOptsFor(m));
    expect(ok.errors).toEqual([]);
    expect([...ok.segments[0]!.bytes]).toEqual([7, 8, 9]);
    m.find("gfx.fake")!.text = "basura";
    const bad = assemble(' org 8000h\n incbin "gfx.fake"\n', asmOptsFor(m));
    expect(bad.errors.map((e) => e.msg)).toEqual(["gfx.fake: no es una lista de bytes"]);
  });

  it("INCBIN de un .asm o de un nombre inexistente da error, no bytes", () => {
    const m = TabsModel.initial("", "");
    expect(assemble(' incbin "main.asm"\n', asmOptsFor(m)).errors).toHaveLength(1);
    expect(assemble(' incbin "nada.fake"\n', asmOptsFor(m)).errors).toHaveLength(1);
  });

  it("INCBIN de una pantalla .scr da sus 6912 bytes: bitmap y atributos en su sitio", () => {
    const m = TabsModel.initial("", "");
    const scr = emptyScr();
    scr[0x0121] = 0x40; scr[6144 + 33] = 0x47;
    m.add("titulo.scr", encodeScrDoc(scr));
    const r = assemble(' org 4000h\n incbin "titulo.scr"\nend: nop\n', asmOptsFor(m));
    expect(r.errors).toEqual([]);
    expect(r.symbols.get("end")).toBe(0x4000 + 6912);
    const b = r.segments[0]!.bytes;
    expect([b[0x0121], b[6144 + 33], b[6144], b[6911]]).toEqual([0x40, 0x47, 0x38, 0x38]);
  });

  it("INCBIN y INCLUDE de las partes de un conjunto de tiles: #attr, #props, #inc", () => {
    const m = TabsModel.initial("", "");
    const ts = newTileSet(16);
    ts.tiles[0]!.atr = [1, 2, 3, 4];
    ts.tiles[0]!.props = 5;
    ts.tiles[0]!.name = "WALL";
    m.add("map set.tiles", serializeTileSet(ts));
    const src = [
      " org 8000h", ' include "map set.tiles#inc"', " ld a, map_set_SOLID", " ld b, map_set_T_WALL",
      ' incbin "map set.tiles#attr"', ' incbin "map set.tiles#props"', "",
    ].join("\n");
    const r = assemble(src, asmOptsFor(m));
    expect(r.errors).toEqual([]);
    // ld a,1 ; ld b,0 ; atributos 1,2,3,4 ; props 5
    expect([...r.segments[0]!.bytes]).toEqual([0x3e, 1, 0x06, 0, 1, 2, 3, 4, 5]);
  });

  it("INCBIN y INCLUDE de un mapa: celdas, #cols, #rle, #marks e #inc", () => {
    const m = TabsModel.initial("", "");
    const mp = newMap(3, 2, "a.tiles");
    mp.data = [[1, 1, 2], [3, 3, 3]];
    mp.marks = [{ k: 9, c: 2, r: 1 }];
    m.add("lvl-1.map", serializeMap(mp));
    const src = [
      " org 8000h", ' include "lvl-1.map#inc"', " ld a, lvl_1_W", " ld b, lvl_1_RLE_BYTES",
      ' incbin "lvl-1.map"', ' incbin "lvl-1.map#cols"', ' incbin "lvl-1.map#rle"', ' incbin "lvl-1.map#marks"', "",
    ].join("\n");
    const r = assemble(src, asmOptsFor(m));
    expect(r.errors).toEqual([]);
    expect([...r.segments[0]!.bytes]).toEqual([
      0x3e, 3, 0x06, 6,
      1, 1, 2, 3, 3, 3,       // filas
      1, 3, 1, 3, 2, 3,       // columnas
      2, 1, 1, 2, 3, 3,       // rle (cuenta, valor)
      9, 2, 1,                // marcadores
    ]);
  });

  it("una parte desconocida o '#inc' de un recurso sin constantes da error; no hay nombres con '#'", () => {
    const m = TabsModel.initial("", "");
    m.add("a.tiles", serializeTileSet(newTileSet(8)));
    m.add("g.fake", "[1]");
    expect(assemble(' incbin "a.tiles#nope"\n', asmOptsFor(m)).errors).toHaveLength(1);
    expect(assemble(' include "g.fake#inc"\n', asmOptsFor(m)).errors).toHaveLength(1);
    expect(m.checkName("a#b.asm")).toContain("#");
  });

  it("un documento inválido sale como error de ensamblado también con INCLUDE #inc", () => {
    const m = TabsModel.initial("", "");
    m.add("a.tiles", "basura");
    const r = assemble(' include "a.tiles#inc"\n', asmOptsFor(m));
    expect(r.errors.map((e) => e.msg)).toEqual(["a.tiles: el documento no es JSON válido"]);
  });

  it("se guarda y se recarga con el resto de pestañas", () => {
    const m = TabsModel.initial("", "");
    m.add("gfx.fake", "[1,2]");
    const p = prefs();
    m.save(p);
    const r = TabsModel.load(p, { asm: "", c: "" });
    expect(r.find("gfx.fake")?.text).toBe("[1,2]");
  });
});
