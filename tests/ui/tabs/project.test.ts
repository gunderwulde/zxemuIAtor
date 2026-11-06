// Proyecto (.tape): la cinta construida es exactamente la que se espera, byte a byte.
// Los esperados se escriben a mano con el formato de cinta de la ROM (cabecera de 17 bytes,
// flag 00/FF, xor de checksum), sin usar las funciones del exportador.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerResource, unregisterResource } from "../../../web/src/res/registry";
import { emptyScr, encodeScrDoc, scrResource } from "../../../web/src/res/scr";
import { parseTapeDoc, tapeResource } from "../../../web/src/res/tape";
import { TabsModel } from "../../../web/src/ui/tabs/model";
import { buildProject, isTape, tapeSources } from "../../../web/src/ui/tabs/project";

beforeAll(() => { registerResource(scrResource); registerResource(tapeResource); });
afterAll(() => { unregisterResource("scr"); unregisterResource("tape"); });

/** [len16][flag][datos][xor] escrito a mano. */
function block(flag: number, data: number[]): number[] {
  const body = [flag, ...data];
  let x = 0;
  for (const b of body) x ^= b;
  return [(body.length + 1) & 0xff, (body.length + 1) >> 8, ...body, x];
}
const name10 = (s: string) => [...s.padEnd(10, " ")].map((c) => c.charCodeAt(0));

function model(files: Record<string, string>): TabsModel {
  const m = TabsModel.initial("", "");
  for (const [n, t] of Object.entries(files)) m.add(n, t);
  return m;
}
const tapeText = (blocks: unknown[]) => JSON.stringify({ v: 1, name: "t", blocks });

describe("manifiesto .tape", () => {
  it("acepta números y cadenas hex", () => {
    const d = parseTapeDoc(tapeText([
      { type: "code", name: "a", src: "a.asm", addr: "0xAFC8", len: "100h" },
      { type: "data", src: "b.asm", addr: "D778h", flag: 5 },
      { type: "basic", name: "b", source: "10 CLS" },
    ]));
    expect(d.blocks[0]).toMatchObject({ addr: 0xafc8, len: 0x100 });
    expect(d.blocks[1]).toMatchObject({ addr: 0xd778, flag: 5 });
    expect(d.blocks[2]).toMatchObject({ type: "basic", autostart: undefined });
  });
  it("rechaza con un motivo lo que no entiende", () => {
    expect(tapeResource.check("basura")).toContain("JSON");
    expect(tapeResource.check('{"v":2}')).toContain("desconocido");
    expect(tapeResource.check(tapeText([{ type: "zip" }]))).toContain("tipo desconocido");
    expect(tapeResource.check(tapeText([{ type: "code", name: "a", src: "a.asm", addr: 70000 }]))).toContain("fuera de");
    expect(tapeResource.check(tapeText([{ type: "code", name: "a", addr: 1 }]))).toContain("falta «src»");
    expect(tapeResource.check(tapeResource.template())).toBeNull();
  });
  it("tapeSources lista las fuentes sin repetir", () => {
    expect(tapeSources(tapeText([
      { type: "basic", name: "b", source: "10 CLS" },
      { type: "code", name: "a", src: "a.asm", addr: 1 },
      { type: "data", src: "a.asm", addr: 2 },
      { type: "data", src: "b.c", addr: 3 },
    ]))).toEqual(["a.asm", "b.c"]);
    expect(tapeSources("basura")).toEqual([]);
  });
});

describe("buildProject", () => {
  it("BASIC + CODE con cabecera + datos sin cabecera, cada uno de su fuente", () => {
    const m = model({
      "a.asm": " org 8000h\n ld a,1\n ret\n",
      // Misma dirección que a.asm: cada fuente es su propio ensamblado.
      "b.asm": " org 8000h\n db 0AAh,0BBh,0CCh\n org 9000h\n db 1,2\n",
      "t.tape": tapeText([
        { type: "basic", name: "LOAD", autostart: 10, source: "10 CLS" },
        { type: "code", name: "prog", src: "a.asm", addr: 0x8000, param2: 0x1234 },
        { type: "data", flag: 7, src: "b.asm", addr: 0x8000, len: 3 },
        { type: "data", flag: 255, src: "b.asm", addr: 0x9000 },
      ]),
    });
    const tape = m.find("t.tape")!;
    expect(isTape(tape)).toBe(true);
    expect(isTape(m.find("a.asm")!)).toBe(false);
    const r = buildProject(m, tape);
    expect(r.messages.filter((x) => x.severity === "error")).toEqual([]);
    const cls = [0x00, 0x0a, 0x02, 0x00, 0xfb, 0x0d];                  // línea 10: CLS (token FBh) + ENTER
    const want = [
      ...block(0x00, [0x00, ...name10("LOAD"), cls.length, 0, 10, 0, cls.length, 0]),
      ...block(0xff, cls),
      ...block(0x00, [0x03, ...name10("prog"), 3, 0, 0x00, 0x80, 0x34, 0x12]),
      ...block(0xff, [0x3e, 0x01, 0xc9]),
      ...block(7, [0xaa, 0xbb, 0xcc]),
      ...block(255, [1, 2]),
    ];
    expect([...r.tap!]).toEqual(want);
    expect(r.blocks.map((b) => b.len)).toEqual([6, 3, 3, 2]);
  });

  it("un recurso y un INCLUDE de otra pestaña entran en el bloque", () => {
    const scr = emptyScr(); scr[0] = 0x55; scr[4095] = 0x66; scr[6144] = 0x07; scr[6144 + 511] = 0x38;
    const m = model({
      "k.h": "MAGIC equ 0A5h\n",
      "pic.scr": encodeScrDoc(scr),
      "a.asm": ' org 8000h\n include "k.h"\n db MAGIC\n incbin "pic.scr#top"\n',
      "t.tape": tapeText([{ type: "data", src: "a.asm", addr: 0x8000 }]),
    });
    const r = buildProject(m, m.find("t.tape")!);
    expect(r.messages.filter((x) => x.severity === "error")).toEqual([]);
    const t = [...r.tap!];
    expect(t[2]).toBe(0xff);                          // flag
    const data = t.slice(3, -1);                      // sin [len16], flag ni xor
    expect(data.length).toBe(1 + 4608);
    expect([data[0], data[1], data[1 + 4095], data[1 + 4096], data[1 + 4607]]).toEqual([0xa5, 0x55, 0x66, 0x07, 0x38]);
  });

  it("errores: fuente que no existe, dirección sin bytes, BASIC mal y error de ensamblado", () => {
    const m = model({
      "a.asm": " org 8000h\n db 1\n",
      "bad.asm": " org 8000h\n ld a,\n",
      "t1.tape": tapeText([{ type: "code", name: "x", src: "nada.asm", addr: 0x8000 }]),
      "t2.tape": tapeText([{ type: "code", name: "x", src: "a.asm", addr: 0x9000 }]),
      "t3.tape": tapeText([{ type: "code", name: "x", src: "a.asm", addr: 0x8000, len: 5 }]),
      "t4.tape": tapeText([{ type: "basic", name: "x", source: "CLS" }]),
      "t5.tape": tapeText([{ type: "code", name: "x", src: "bad.asm", addr: 0x8000 }]),
    });
    const text = (n: string) => buildProject(m, m.find(n)!).messages.map((x) => x.text).join("\n");
    expect(buildProject(m, m.find("t1.tape")!).tap).toBeNull();
    expect(text("t1.tape")).toContain("no hay una pestaña .asm o .c llamada «nada.asm»");
    expect(text("t2.tape")).toContain("no hay bytes ensamblados en 9000h");
    expect(text("t3.tape")).toContain("no hay bytes ensamblados en 8001h");
    expect(text("t4.tape")).toContain("la línea debe empezar por su número");
    expect(buildProject(m, m.find("t5.tape")!).ok).toBe(false);
    expect(buildProject(m, m.find("t5.tape")!).diags.some((d) => d.tab === "bad.asm" && d.severity === "error")).toBe(true);
  });
});
