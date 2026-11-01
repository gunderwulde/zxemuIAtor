// U1: mapa dirección ↔ línea con textos escritos a mano. Las direcciones salen de contar
// los bytes de cada instrucción (entre paréntesis); el lineMap lo da el ensamblador (A1),
// y el cLineMap se escribe a mano con el formato de docs/c-abi.md §8.
import { describe, expect, it } from "vitest";
import { assemble } from "../../../web/src/asm";
import { SourceMap, asmLineOwners } from "../../../web/src/ui/tabs/srcmap";

// Línea (1-based) a la izquierda; dirección y bytes a la derecha.
const GEN = [
  "        org 8000h",            //  1
  "_main:",                       //  2
  "; m.c:5: int main(void) {",    //  3
  "        push ix",              //  4  8000 (2)
  "; m.c:6: x = 1;",              //  5
  "        ld a,1",               //  6  8002 (2)
  "        ld (8100h),a",         //  7  8004 (3)
  ".l1:",                         //  8
  "; m.c:7: while (x)",           //  9
  "        ld a,(8100h)",         // 10  8007 (3)
  "        or a",                 // 11  800A (1)
  "        jr z,.l2",             // 12  800B (2)
  "; m.c:8: x--;",                // 13
  "        dec a",                // 14  800D (1)
  "        ld (8100h),a",         // 15  800E (3)
  "; m.c:7: while (x)",           // 16
  "        jr .l1",               // 17  8011 (2)
  ".l2:",                         // 18
  "        pop ix",               // 19  8013 (2)
  "        ret",                  // 20  8015 (1)
  "",                             // 21  (fin de la función)
  "lib:    nop",                  // 22  8016 (1)  librería: de ninguna línea C
  "        ret",                  // 23  8017 (1)
].join("\n");
const CMAP = [
  { file: "m.c", line: 5, asmLine: 3 },
  { file: "m.c", line: 6, asmLine: 5 },
  { file: "m.c", line: 7, asmLine: 9 },
  { file: "m.c", line: 8, asmLine: 13 },
  { file: "m.c", line: 7, asmLine: 16 },
];

describe("programa C", () => {
  const asm = assemble(GEN);
  const map = SourceMap.fromC(GEN, CMAP, asm.lineMap, "gen.asm");

  it("el texto escrito a mano ensambla", () => expect(asm.errors).toEqual([]));

  it("dueño de cada línea generada: hasta la próxima marca o la primera línea vacía", () => {
    const o = asmLineOwners(GEN, CMAP);
    expect(Array.from(o.slice(1, 24))).toEqual([
      -1, -1, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4, -1, -1, -1,
    ]);
  });

  it("PC → línea C", () => {
    const line = (a: number) => map.srcAt(a)?.line ?? null;
    expect([0x8000, 0x8001].map(line)).toEqual([5, 5]);
    expect([0x8002, 0x8004, 0x8006].map(line)).toEqual([6, 6, 6]);
    expect([0x8007, 0x800a, 0x800c].map(line)).toEqual([7, 7, 7]);
    expect([0x800d, 0x8010].map(line)).toEqual([8, 8]);
    expect([0x8011, 0x8013, 0x8015].map(line)).toEqual([7, 7, 7]); // jr y epílogo
    expect([0x8016, 0x8017, 0x7fff].map(line)).toEqual([null, null, null]);
    expect(map.srcAt(0x8002)!.file).toBe("m.c");
  });

  it("línea C → inicio de cada tramo (breakpoints)", () => {
    expect(map.addrsOf("m.c", 5)).toEqual([0x8000]);
    expect(map.addrsOf("m.c", 6)).toEqual([0x8002]);
    expect(map.addrsOf("m.c", 7)).toEqual([0x8007, 0x8011]);
    expect(map.addrsOf("m.c", 8)).toEqual([0x800d]);
    expect(map.addrsOf("m.c", 9)).toEqual([]);
    expect(map.addrsOf("otro.c", 5)).toEqual([]);
  });

  it("primeras instrucciones de línea y de función", () => {
    const starts = [...map.lineStart.keys()].filter((a) => map.lineStart[a]);
    expect(starts).toEqual([0x8000, 0x8002, 0x8007, 0x800d, 0x8011]);
    expect([...map.funcEntry.keys()].filter((a) => map.funcEntry[a])).toEqual([0x8000]);
  });

  it("pestaña del ensamblador generado: línea generada por dirección y al revés", () => {
    expect(map.lineIn("gen.asm", 0x8004)).toBe(7);
    expect(map.lineIn("m.c", 0x8004)).toBe(6);
    expect(map.lineIn("gen.asm", 0x8016)).toBe(22);
    expect(map.lineIn("m.c", 0x8016)).toBeNull();
    expect(map.addrsOf("gen.asm", 10)).toEqual([0x8007]);
  });
});

describe("programa en ensamblador con INCLUDE de otra pestaña", () => {
  const MAIN = [
    "        org 9000h",          // 1
    "start:  call sub",           // 2  9000 (3)
    "        ret",                // 3  9003 (1)
    "        include \"Sub.asm\"",// 4
  ].join("\n");
  const SUB = [
    "sub:    ld a,1",             // 1  9004 (2)
    "        ret",                // 2  9006 (1)
  ].join("\n");
  const asm = assemble(MAIN, { include: (p) => (p.toLowerCase() === "sub.asm" ? SUB : undefined) });
  const map = SourceMap.fromAsm(asm.lineMap, "main.asm", (f) => f.toLowerCase());

  it("ensambla", () => expect(asm.errors).toEqual([]));

  it("cada dirección en su pestaña", () => {
    expect(map.srcAt(0x9000)).toEqual({ file: "main.asm", line: 2 });
    expect(map.srcAt(0x9003)).toEqual({ file: "main.asm", line: 3 });
    expect(map.srcAt(0x9005)).toEqual({ file: "sub.asm", line: 1 });
    expect(map.lineIn("sub.asm", 0x9006)).toBe(2);
    expect(map.lineIn("main.asm", 0x9006)).toBeNull();
    expect(map.addrsOf("sub.asm", 2)).toEqual([0x9006]);
    expect(map.addrsOf("main.asm", 4)).toEqual([]);
  });
});
