// U1: construir y ejecutar pestañas contra el núcleo real (core.wasm + ROM 48K).
// Oráculos: la semántica de cada programa C/ensamblador escrito a mano (o del ejemplo,
// leyendo su fuente), la fuente de la ROM para el OCR (tests/util/screen.ts) y el
// formato de cabecera de cinta (manual del 48K, cap. 20: tipo, nombre de 10 caracteres).
import { beforeEach, describe, expect, it } from "vitest";
import { Core } from "../../../web/src/emu/core";
import { DEFAULT_C_EXAMPLE, C_EXAMPLES } from "../../../web/src/clib";
import { atSafePoint } from "../../../web/src/ui/run";
import { GEN_NAME, TabsModel } from "../../../web/src/ui/tabs/model";
import { buildAndRun, buildTapFor } from "../../../web/src/ui/tabs/build";
import { KEY } from "../../util/keys";
import { screenLines } from "../../util/screen";
import { instantiate, rom48 } from "../../util/wasm";

let core: Core;
beforeEach(async () => {
  core = new Core(await instantiate("core"));
  core.loadRom(rom48());
  for (let i = 0; i < 150; i++) core.runFrame();
});
const frames = (n: number) => { for (let i = 0; i < n; i++) core.runFrame(); };
const attr = (col: number, row: number) => core.ram()[0x5800 + 32 * row + col]!;
function hold(k: string, down: boolean) { core.x.zx_key(KEY[k]![0], KEY[k]![1], down ? 1 : 0); }
function back(): boolean {
  for (let i = 0; i < 4000 && !atSafePoint(core); i++) core.x.zx_step();
  return atSafePoint(core);
}

/** Modelo con las pestañas dadas (la primera activa y principal). */
function model(files: [string, string][]): TabsModel {
  const m = new TabsModel();
  for (const [n, t] of files) m.add(n, t, m.tabs.length);
  m.setActive(m.tabs[0]!.id);
  m.setMain(m.tabs[0]!.id);
  return m;
}

describe("primera carga: la pestaña main.c con el ejemplo por defecto", () => {
  it("es el arco iris (visual) y se ejecuta: bandas de PAPER con BRIGHT que avanzan; ESPACIO vuelve a BASIC", () => {
    expect(DEFAULT_C_EXAMPLE.id).toBe("rainbow");
    const m = TabsModel.initial("; asm\n", DEFAULT_C_EXAMPLE.source);
    m.setActive(m.find("main.c")!.id);
    const target = m.runTarget()!;
    expect(target.name).toBe("main.c");
    const r = buildAndRun(core, m, target);
    expect(r.messages.filter((x) => x.severity !== "info")).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.build.kind).toBe("c");
    frames(10);
    // Del fuente: strip[i] = ((((i >> 2) + phase) & 7) << 3) | 0x40, fila r = strip + 4·(r & 7).
    const paper = (c: number, row: number) => (attr(c, row) >> 3) & 7;
    for (let row = 0; row < 22; row++) for (let c = 0; c < 32; c++) expect(attr(c, row) & 0xc7).toBe(0x40);
    expect([paper(0, 0), paper(1, 0), paper(2, 0), paper(3, 0)]).toEqual(Array(4).fill(paper(0, 0)));
    expect(paper(4, 0)).toBe((paper(0, 0) + 1) & 7);
    expect(paper(0, 1)).toBe(paper(4, 0));
    expect(paper(0, 8)).toBe(paper(0, 0));
    const before = paper(0, 0);
    frames(1);
    expect(paper(0, 0)).toBe((before + 1) & 7); // phase++ por frame
    hold("SPACE", true); frames(3); hold("SPACE", false); frames(6);
    expect(back()).toBe(true);
    for (let c = 0; c < 32; c++) expect(attr(c, 0)).toBe(0x38); // set_color(0x38); cls()
  });
});

describe("C en pestañas", () => {
  it("hola mundo (ejemplo 1) en una pestaña: el texto sale en pantalla (OCR)", () => {
    const hello = C_EXAMPLES.find((e) => e.id === "hello")!.source;
    const m = model([["hola.c", hello]]);
    const r = buildAndRun(core, m, m.runTarget()!);
    expect(r.ok).toBe(true);
    frames(20);
    const t = screenLines(core.ram());
    expect(t[4]!.slice(10, 22)).toBe("Hola, mundo!");
    expect(t[8]!.slice(6)).toMatch(/^Tinta 1: Spectrum/);
    expect(t[14]!.slice(6)).toMatch(/^Tinta 7: Spectrum/);
  });

  it("varios ficheros: .h y .c sin main entran; otro .c con main no (no choca)", () => {
    const m = model([
      ["main.c", '#include "util.h"\nunsigned int result;\nint main(void) {\n    result = twice(21);\n    return 0;\n}\n'],
      ["util.h", "int twice(int x);\n"],
      ["util.c", '#include "util.h"\nint twice(int x) { return x + x; }\n'],
      ["otro.c", "int main(void) { return 1; }\n"],
    ]);
    const r = buildAndRun(core, m, m.runTarget()!);
    expect(r.messages.filter((x) => x.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
    frames(5);
    expect(back()).toBe(true);
    const a = r.report!.asm.symbols.get("_result")!;
    expect(core.ram()[a]! | (core.ram()[a + 1]! << 8)).toBe(42);
  });

  it("error de compilación en un .h: diagnóstico en esa pestaña y línea; no se toca la máquina", () => {
    const m = model([
      ["main.c", '#include "defs.h"\nint main(void) { return N; }\n'],
      ["defs.h", "#define N 3\nint bad = ;\n"],
    ]);
    const pc = core.regs.get16("pc");
    const r = buildAndRun(core, m, m.runTarget()!);
    expect(r.ok).toBe(false);
    expect(r.report).toBeNull();
    const d = r.diags.find((x) => x.severity === "error")!;
    expect([d.tab, d.line]).toEqual(["defs.h", 2]);
    expect(r.messages.at(-1)!.text).toMatch(/de compilación: no se ejecuta nada/);
    expect(core.regs.get16("pc")).toBe(pc);
  });

  it("error del ensamblador en un __asm: en la pestaña generada y en la línea C de la que sale", () => {
    const m = model([["main.c", "int main(void) {\n    __asm\n        ld q,1\n    __endasm;\n    return 0;\n}\n"]]);
    const r = buildAndRun(core, m, m.runTarget()!);
    expect(r.ok).toBe(false);
    const gen = r.diags.find((d) => d.tab === GEN_NAME)!;
    expect(r.build.source.split("\n")[gen.line - 1]).toMatch(/ld q,1/);
    const c = r.diags.find((d) => d.tab === "main.c")!;
    expect(c.line).toBe(3);
    expect(c.msg).toMatch(/ensamblador/);
    expect(r.messages.some((x) => x.text.startsWith(`${GEN_NAME}:${gen.line}:`))).toBe(true);
  });

  it("exportar TAP de una pestaña C: cargador y bloque CODE con el nombre de la pestaña", () => {
    const m = model([["juego.c", "int main(void) { return 7; }\n"]]);
    const r = buildTapFor(m, m.runTarget()!);
    expect(r.messages.filter((x) => x.severity === "error")).toEqual([]);
    const tap = r.exp!.tap!;
    // Bloque 1: len(2) flag 00, tipo 0 (programa), nombre de 10 caracteres.
    expect([tap[2], tap[3]]).toEqual([0, 0]);
    expect(String.fromCharCode(...tap.slice(4, 14))).toBe("juego     ");
  });
});

describe("ensamblador en pestañas", () => {
  it("INCLUDE de otra pestaña (y la activa .h no se ejecuta: va la principal)", () => {
    const m = model([
      ["main.asm", '        org 9000h\nstart:  call setx\n        ret\n        include "rutinas.asm"\n'],
      ["rutinas.asm", "setx:   ld a,5Ah\n        ld (9100h),a\n        ret\n"],
      ["notas.h", "// nada\n"],
    ]);
    m.setActive(m.find("notas.h")!.id);
    const t = m.runTarget()!;
    expect(t.name).toBe("main.asm");
    const r = buildAndRun(core, m, t);
    expect(r.ok).toBe(true);
    frames(2);
    expect(back()).toBe(true);
    expect(core.ram()[0x9100]).toBe(0x5a);
    expect(r.fin!.srcMap.srcAt(0x9004)).toEqual({ file: "rutinas.asm", line: 1 });
  });

  it("error en el fichero incluido: diagnóstico en su pestaña", () => {
    const m = model([
      ["main.asm", '        org 9000h\n        include "mal.asm"\n        ret\n'],
      ["mal.asm", "        nop\n        ld q,1\n"],
    ]);
    const r = buildAndRun(core, m, m.runTarget()!);
    expect(r.ok).toBe(false);
    expect(r.diags.map((d) => [d.tab, d.line])).toEqual([["mal.asm", 2]]);
  });
});
