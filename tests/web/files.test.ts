// W1: detección de formato por extensión y mensajes de error de carga.
import { describe, expect, it } from "vitest";
import { formatOf, loadFile, type FileLoader } from "../../web/src/ui/files";

function fake(ret: number, throws?: string) {
  const calls: string[] = [];
  const f = (name: string) => (d: Uint8Array) => {
    calls.push(`${name}:${d.length}`);
    if (throws) throw new Error(throws);
    return ret;
  };
  const core: FileLoader = { loadTap: f("tap"), loadSna: f("sna"), loadZ80: f("z80") };
  return { core, calls };
}

describe("files", () => {
  it("formato por extensión, sin distinguir mayúsculas", () => {
    expect(formatOf("juego.tap")).toBe("tap");
    expect(formatOf("SHOTLAND.TAP")).toBe("tap");
    expect(formatOf("a.b.Sna")).toBe("sna");
    expect(formatOf("x.z80")).toBe("z80");
    expect(formatOf("x.tzx")).toBeNull();
    expect(formatOf("tap")).toBeNull();
  });

  it("llama al cargador correcto", () => {
    for (const [name, fn] of [["a.tap", "tap"], ["a.sna", "sna"], ["a.Z80", "z80"]]) {
      const { core, calls } = fake(0);
      expect(loadFile(core, name!, new Uint8Array(7)).ok).toBe(true);
      expect(calls).toEqual([`${fn}:7`]);
    }
  });

  it("errores visibles: formato, códigos de zx.h y excepciones", () => {
    expect(loadFile(fake(0).core, "a.tzx", new Uint8Array(1))).toMatchObject({ ok: false });
    expect(loadFile(fake(-1).core, "a.sna", new Uint8Array(1)).message).toMatch(/longitud/);
    expect(loadFile(fake(-2).core, "a.z80", new Uint8Array(1)).message).toMatch(/malformado/);
    expect(loadFile(fake(-3).core, "a.z80", new Uint8Array(1)).message).toMatch(/48K/);
    expect(loadFile(fake(-9).core, "a.z80", new Uint8Array(1)).message).toMatch(/-9/);
    expect(loadFile(fake(0, "fichero demasiado grande").core, "a.tap", new Uint8Array(1)))
      .toMatchObject({ ok: false, message: expect.stringMatching(/demasiado grande/) });
  });
});
