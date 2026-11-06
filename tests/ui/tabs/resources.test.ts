// Recursos como pestañas: nombres válidos, INCBIN desde el ensamblador y persistencia.
// El tipo "fake" se registra aquí: el valor esperado (bytes) está escrito a mano.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assemble } from "../../../web/src/asm";
import { registerResource, resourceKindOf, unregisterResource } from "../../../web/src/res/registry";
import { emptyScr, encodeScrDoc, scrResource } from "../../../web/src/res/scr";
import { TabsModel, type Prefs } from "../../../web/src/ui/tabs/model";
import { asmOptsFor } from "../../../web/src/ui/tabs/build";

beforeAll(() => { registerResource(scrResource); registerResource({
  ext: "fake", label: "Fake",
  template: () => "[]",
  check: (t) => (/^\[[\d,]*\]$/.test(t) ? null : "no es una lista de bytes"),
  toBin: (t) => Uint8Array.from(JSON.parse(t) as number[]),
}); });
afterAll(() => { unregisterResource("fake"); unregisterResource("scr"); });

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

  it("se guarda y se recarga con el resto de pestañas", () => {
    const m = TabsModel.initial("", "");
    m.add("gfx.fake", "[1,2]");
    const p = prefs();
    m.save(p);
    const r = TabsModel.load(p, { asm: "", c: "" });
    expect(r.find("gfx.fake")?.text).toBe("[1,2]");
  });
});
