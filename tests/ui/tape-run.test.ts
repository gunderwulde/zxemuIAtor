// Ejecutar un proyecto: se construye la cinta, se inserta y se teclea LOAD "": el núcleo real
// carga los bloques (trampa de LD-BYTES) y el BASIC de la cinta lanza el código.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Core } from "../../web/src/emu/core";
import { registerResource, unregisterResource } from "../../web/src/res/registry";
import { tapeResource } from "../../web/src/res/tape";
import { TabsModel } from "../../web/src/ui/tabs/model";
import { buildProject } from "../../web/src/ui/tabs/project";
import { startTape } from "../../web/src/ui/tape-run";
import { instantiate, rom48 } from "../util/wasm";

beforeAll(() => registerResource(tapeResource));
afterAll(() => unregisterResource("tape"));

describe("startTape", () => {
  it("un proyecto con dos bloques de código y BASIC arranca solo", async () => {
    const m = TabsModel.initial("", "");
    // El BASIC carga dos bloques y salta al primero; éste lee lo que dejó el segundo.
    m.add("a.asm", " org 9000h\n ld a,(9100h)\n ld (9200h),a\n ret\n");
    m.add("b.asm", " org 9100h\n db 5Ah\n");
    m.add("t.tape", JSON.stringify({ v: 1, name: "t", blocks: [
      { type: "basic", name: "go", autostart: 10, source: '10 CLEAR 36863\n20 LOAD "" CODE\n30 LOAD "" CODE\n40 RANDOMIZE USR 36864' },
      { type: "code", name: "a", src: "a.asm", addr: 0x9000 },
      { type: "code", name: "b", src: "b.asm", addr: 0x9100 },
    ] }));
    const r = buildProject(m, m.find("t.tape")!);
    expect(r.messages.filter((x) => x.severity === "error")).toEqual([]);

    const core = new Core(await instantiate("core"));
    core.loadRom(rom48());
    expect(startTape(core, r.tap!)).toBeNull();
    for (let i = 0; i < 400; i++) core.runFrame();
    const ram = core.ram();
    expect(ram[0x9100]).toBe(0x5a);              // el segundo bloque se cargó
    expect(ram[0x9200]).toBe(0x5a);              // y el primero se ejecutó y lo copió
  });

  it("devuelve el motivo si el núcleo rechaza la cinta", async () => {
    const core = new Core(await instantiate("core"));
    core.loadRom(rom48());
    expect(startTape(core, Uint8Array.from([1, 2, 3]))).toContain("rechazó");
  });
});

describe("runTarget con proyecto", () => {
  it("desde una fuente del proyecto se ejecuta el proyecto; desde otra pestaña, ella misma", () => {
    const m = TabsModel.initial(" org 8000h\n ret\n", "");
    m.add("lvl.asm", " org 9000h\n ret\n");
    m.add("t.tape", JSON.stringify({ v: 1, name: "t", blocks: [{ type: "code", name: "a", src: "lvl.asm", addr: 0x9000 }] }));
    const tape = m.find("t.tape")!, lvl = m.find("lvl.asm")!, mainAsm = m.find("main.asm")!;
    m.setMain(tape.id);
    m.setActive(lvl.id);
    expect(m.runTarget()).toBe(tape);
    m.setActive(mainAsm.id);
    expect(m.runTarget()).toBe(mainAsm);
    m.setActive(tape.id);
    expect(m.runTarget()).toBe(tape);
  });
});
