// U1: depurar un programa C (sin DOM) contra el núcleo real y el bucle real con reloj
// falso, como tests/debugger/controller.test.ts. Las líneas del programa se cuentan a
// mano sobre su fuente; lo que se comprueba en cada parada sale de la semántica de C
// (qué asignaciones se han hecho ya), no del compilador.
import { beforeEach, describe, expect, it } from "vitest";
import { Core } from "../../../web/src/emu/core";
import { Loop } from "../../../web/src/emu/loop";
import { Debugger } from "../../../web/src/ui/debugger/controller";
import { TabsModel } from "../../../web/src/ui/tabs/model";
import { buildAndRun, type RunResult } from "../../../web/src/ui/tabs/build";
import { stepSourceLine } from "../../../web/src/ui/tabs/debug";
import type { SourceMap } from "../../../web/src/ui/tabs/srcmap";
import { instantiate, rom48 } from "../../util/wasm";

const SRC = [
  "unsigned char x, y;",            //  1
  "unsigned int r;",                //  2
  "void bump(void) {",              //  3
  "    y++;",                       //  4
  "}",                              //  5
  "unsigned int fact(unsigned int n) {", // 6
  "    if (n <= 1) return 1;",      //  7
  "    return n * fact(n - 1);",    //  8
  "}",                              //  9
  "int main(void) {",               // 10
  "    x = 1;",                     // 11
  "    bump();",                    // 12
  "    x = 2;",                     // 13
  "    r = fact(5);",               // 14
  "    x = 3;",                     // 15
  "    return 0;",                  // 16
  "}",                              // 17
].join("\n") + "\n";

let core: Core;
let loop: Loop;
let dbg: Debugger;
let run: RunResult;
let map: SourceMap;
let now = 0;

const sym = (s: string) => run.report!.asm.symbols.get(s)!;
const peek = (s: string) => core.ram()[sym(s)]!;
const peek16 = (s: string) => peek(s) | (core.ram()[sym(s) + 1]! << 8);
const line = () => { const l = map.srcAt(dbg.pc); return l ? `${l.file}:${l.line}` : null; };

async function runUntilPaused(max = 50): Promise<void> {
  for (let i = 0; i < max && !loop.isPaused; i++) {
    now += 20;
    loop.tick(now);
    await Promise.resolve();
  }
  await Promise.resolve();
}

/** Breakpoint en la línea C y corre hasta ella (como el margen de una pestaña). */
async function runToLine(l: number): Promise<void> {
  dbg.setSourceBps(map.addrsOf("main.c", l));
  dbg.resume();
  await runUntilPaused();
  dbg.setSourceBps([]);
}

beforeEach(async () => {
  core = new Core(await instantiate("core"));
  core.loadRom(rom48());
  for (let i = 0; i < 150; i++) core.runFrame();
  const m = new TabsModel();
  const t = m.add("main.c", SRC);
  m.setActive(t.id);
  run = buildAndRun(core, m, t);
  expect(run.messages.filter((x) => x.severity !== "info")).toEqual([]);
  map = run.fin!.srcMap;
  now = 0;
  loop = new Loop(core, { now: () => now, raf: () => {} });
  loop.start();
  loop.setPaused(true);
  dbg = new Debugger(core, loop);
  dbg.setProgram(run.report!.asm.lineMap);
});

describe("depurar C", () => {
  // Una función con parámetros o locales empieza con el prólogo (push ix…), que es de la
  // línea de su cabecera; una sin marco no tiene prólogo y empieza en su primera sentencia.
  it("cada función empieza en la línea de su cabecera o, sin marco, en su primera sentencia", () => {
    expect(map.srcAt(sym("_main"))).toEqual({ file: "main.c", line: 11 });
    expect(map.srcAt(sym("_bump"))).toEqual({ file: "main.c", line: 4 });
    expect(map.srcAt(sym("_fact"))).toEqual({ file: "main.c", line: 6 });
    // El crt0 no es de ninguna línea C.
    expect(map.srcAt(run.report!.asm.entry)).toBeNull();
  });

  it("breakpoint en una línea C: para antes de ejecutarla (y después de las anteriores)", async () => {
    expect(map.addrsOf("main.c", 13).length).toBe(1);
    await runToLine(13);
    expect(dbg.pc).toBe(map.addrsOf("main.c", 13)[0]);
    expect(line()).toBe("main.c:13");
    expect([peek("_x"), peek("_y")]).toEqual([1, 1]); // x = 1 y bump() hechos; x = 2 no
  });

  it("paso por línea C entra en la función llamada", async () => {
    await runToLine(12);
    expect(peek("_y")).toBe(0);
    expect(stepSourceLine(dbg, core, map, false)).toBe(true);
    expect(line()).toBe("main.c:4");
    expect(peek("_y")).toBe(0);
    expect(stepSourceLine(dbg, core, map, false)).toBe(true); // y++ y vuelta (sin parar en el resto de la 12)
    expect(line()).toBe("main.c:13");
    expect(peek("_y")).toBe(1);
  });

  it("paso por encima de una línea C no se para en la función llamada, ni con recursión", async () => {
    await runToLine(12);
    expect(stepSourceLine(dbg, core, map, true)).toBe(true);
    expect(line()).toBe("main.c:13");
    expect(peek("_y")).toBe(1);
    expect(stepSourceLine(dbg, core, map, true)).toBe(true);
    expect(line()).toBe("main.c:14");
    expect(peek("_x")).toBe(2);
    expect(stepSourceLine(dbg, core, map, true)).toBe(true); // fact(5): 5 llamadas anidadas
    expect(line()).toBe("main.c:15");
    expect(peek16("_r")).toBe(120);
  });

  it("paso por línea dentro de una función recursiva vuelve a su primera línea", async () => {
    await runToLine(14);
    expect(stepSourceLine(dbg, core, map, false)).toBe(true);
    expect(line()).toBe("main.c:6");
    expect(stepSourceLine(dbg, core, map, false)).toBe(true);
    expect(line()).toBe("main.c:7");
  });

  it("presupuesto agotado: un bucle sin líneas C (aquí, tras volver a BASIC) no cuelga", async () => {
    await runToLine(16);
    let ok = true;
    for (let i = 0; i < 6 && ok; i++) ok = stepSourceLine(dbg, core, map, true, 70000);
    expect(ok).toBe(false);
    expect(map.srcAt(dbg.pc)).toBeNull();
  });
});
