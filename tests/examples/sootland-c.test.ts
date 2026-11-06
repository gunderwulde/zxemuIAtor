// Ejemplo "Sootland en C": el motor reescrito en C debe compilar, caber en su hueco, arrancar
// como el original (mismo cargador, mismos niveles, misma pantalla) y jugar igual.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assemble } from "../../web/src/asm/assembler";
import { compile } from "../../web/src/cc/index";
import { clibResolve } from "../../web/src/clib/index";
import { Core } from "../../web/src/emu/core";
import { registerResource, unregisterResource } from "../../web/src/res/registry";
import { scrResource } from "../../web/src/res/scr";
import { tilesResource } from "../../web/src/res/tiles";
import { tapeResource } from "../../web/src/res/tape";
import { TabsModel } from "../../web/src/ui/tabs/model";
import { prepare } from "../../web/src/ui/tabs/build";
import { buildProject } from "../../web/src/ui/tabs/project";
import { startTape } from "../../web/src/ui/tape-run";
import { KEY, press, runFrames } from "../core/tape/tap";
import { instantiate, ROOT, rom48 } from "../util/wasm";

const EX = join(ROOT, "web", "src", "examples");
beforeAll(() => { registerResource(scrResource); registerResource(tilesResource); registerResource(tapeResource); });
afterAll(() => { unregisterResource("scr"); unregisterResource("tiles"); unregisterResource("tape"); });

const h = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);
/** Bloques de un TAP (flag + datos + checksum, sin la longitud). */
function tapBlocks(t: number[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let p = 0; p < t.length;) {
    const n = t[p]! | (t[p + 1]! << 8);
    out.push(Uint8Array.from(t.slice(p + 2, p + 2 + n)));
    p += 2 + n;
  }
  return out;
}

function workspace(dir: string): { m: TabsModel; main: string } {
  const proj = JSON.parse(readFileSync(join(EX, dir, "project.json"), "utf8")) as { files: string[]; main: string };
  const m = TabsModel.initial("", "");
  m.close(m.find("main.c")!.id);
  for (const e of proj.files) m.add(e.slice(e.lastIndexOf("/") + 1), readFileSync(e.includes("/") ? join(EX, e) : join(EX, dir, e), "utf8"));
  return { m, main: proj.main };
}

/** Símbolos y tamaño de la imagen del motor en C, compilado aparte del proyecto. */
function engineC(): { sym: (n: string) => number; end: number } {
  const d = join(EX, "sootland-c");
  const files = new Map(["engine.c", "hw.c", "hw.h"].map((n) => [n, readFileSync(join(d, n), "utf8")] as const));
  const r = compile(files, { main: "engine.c", includeResolver: (n) => clibResolve(n) });
  expect(r.errors.filter((e) => e.severity === "error")).toEqual([]);
  const a = assemble(r.asm, { include: (n) => clibResolve(n) });
  expect(a.errors).toEqual([]);
  const seg = a.segments[0]!;
  return { sym: (n) => a.symbols.get(n)!, end: seg.addr + seg.bytes.length };
}

/** Arranca el proyecto hasta el primer fotograma de juego del nivel 1 (control: cursor, dispara con 0). */
async function boot(dir: string): Promise<{ core: Core; tap: number[] }> {
  const { m, main } = workspace(dir);
  const r = buildProject(m, m.find(main)!);
  expect(r.messages.filter((x) => x.severity === "error")).toEqual([]);
  const core = new Core(await instantiate("core"));
  core.loadRom(rom48());
  expect(startTape(core, r.tap!)).toBeNull();
  runFrames(core, 300); press(core, [KEY.SPACE], 10); runFrames(core, 1000); press(core, [KEY.SPACE], 10); runFrames(core, 700);
  press(core, [[3, 1]], 10); runFrames(core, 80);
  core.x.zx_key(4, 0, 1); runFrames(core, 300); core.x.zx_key(4, 0, 0);
  runFrames(core, 200); press(core, [KEY.SPACE], 10); runFrames(core, 100);
  return { core, tap: [...r.tap!] };
}

/** Frames que tarda el original en gastar el temporizador del enemigo (250 vueltas del bucle). */
async function origFrames(): Promise<number> {
  const { m } = workspace("sootland");
  const b = prepare(m, m.find("engine.asm")!);
  const sym = assemble(b.source, b.asmOpts).symbols.get("v_enemy_timer")!;
  const { core } = await boot("sootland");
  core.x.zx_poke(sym, 250); core.x.zx_poke(sym + 1, 0);
  const on = assemble(b.source, b.asmOpts).symbols.get("v_enemy_on")!;
  let fr = 0; for (; fr < 3000 && !core.ram()[on]; fr++) runFrames(core, 1);
  return fr;
}

describe("ejemplo Sootland en C", () => {
  it("project.json lista todos los ficheros propios y los compartidos existen", () => {
    const proj = JSON.parse(readFileSync(join(EX, "sootland-c", "project.json"), "utf8")) as { files: string[] };
    for (const e of proj.files) expect(() => readFileSync(e.includes("/") ? join(EX, e) : join(EX, "sootland-c", e))).not.toThrow();
    const own = proj.files.filter((e) => !e.includes("/"));
    expect(own).toEqual(expect.arrayContaining(["engine.c", "hw.c", "hw.h", "pieces.asm", "sootland.tape"]));
  });

  it("el código y las variables caben entre EA60h y FFFEh (FFFFh es el control del menú)", () => {
    const { sym, end } = engineC();
    expect(end).toBeLessThanOrEqual(0xfffa);                       // el bloque acaba en FFFAh
    expect(sym("__bss_end")).toBeLessThan(0xffff);
  });

  it("la cinta tiene los mismos 14 bloques; sólo cambia el del motor", () => {
    const orig = workspace("sootland"), c = workspace("sootland-c");
    const a = tapBlocks([...buildProject(orig.m, orig.m.find(orig.main)!).tap!]);
    const b = tapBlocks([...buildProject(c.m, c.m.find(c.main)!).tap!]);
    expect(b.length).toBe(a.length);
    expect(b.map((x, i) => (i === 4 ? "" : h(x)))).toEqual(a.map((x, i) => (i === 4 ? "" : h(x))));
    expect(b[4]!.length).toBe(a[4]!.length);
    // Las tres piezas de recursos (marco, fuente y sprites) son idénticas: los 0x1288 primeros bytes.
    expect(h(b[4]!.subarray(1, 1 + 0x1288))).toBe(h(a[4]!.subarray(1, 1 + 0x1288)));
  });

  it("arranca, carga el nivel 1 y dibuja la misma pantalla que el original (salvo el bonus, que depende de R)", async () => {
    const o = await boot("sootland"), c = await boot("sootland-c");
    expect(h(c.core.ram().subarray(0xca38, 0xca38 + 1222))).toBe(h(tapBlocks(c.tap)[5]!.subarray(1, -1)));
    const sa = o.core.ram(), sb = c.core.ram();
    let diff = 0;
    for (let i = 0; i < 0x1b00; i++) {
      // Fila de celdas del byte i: bitmap en orden de pantalla, atributos de 32 en 32.
      const row = i < 0x1800 ? ((i >> 11) << 3) | ((i >> 5) & 7) : (i - 0x1800) >> 5;
      if (row === 12 || row === 13) continue;                       // el bonus cruza la fila 12
      if (sa[0x4000 + i] !== sb[0x4000 + i]) diff++;
    }
    expect(diff).toBe(0);
  });

  it("un disparo sobre el enemigo suma 100 puntos, acelera el juego y empieza otra escena", async () => {
    const { core } = await boot("sootland-c");
    const { sym } = engineC();
    const rd = (n: string, off = 0) => core.ram()[sym(n) + off]!;
    const poke = (n: string, v: number, off = 0) => core.x.zx_poke(sym(n) + off, v);
    // Que el enemigo aparezca tras 250 vueltas del bucle y esperar a que lo haga.
    poke("_enemy_timer", 250); poke("_enemy_timer", 0, 1);
    let fr = 0; for (; fr < 2000 && !rd("_enemy_on"); fr++) runFrames(core, 1);
    // Mismo ritmo que el original (a la misma velocidad de bucle, 250 vueltas son los mismos fotogramas).
    expect(Math.abs(fr - await origFrames())).toBeLessThanOrEqual(10);
    expect(rd("_enemy_on")).toBe(1);
    const wave = rd("_wave"), score = rd("_digits", 2);
    // Mira sobre él, en su escena. struct sprite: gfx(2) mask(2) save(2) col row w h on.
    poke("_scene", rd("_enemy_scene"));
    poke("_crosshair", rd("_enemy", 6), 6); poke("_crosshair", rd("_enemy", 7), 7);
    press(core, [KEY.SPACE], 30); runFrames(core, 2);
    expect(rd("_wave")).toBe(wave + 1);
    expect(rd("_digits", 2)).toBe((score + 1) % 10);
    expect(rd("_pace")).toBe(46);                                    // 50 - 4
  });

  it("si se acaba el tiempo del enemigo pierdes una vida y vuelve a empezar la escena", async () => {
    const { core } = await boot("sootland-c");
    const { sym } = engineC();
    const rd = (n: string, off = 0) => core.ram()[sym(n) + off]!;
    const poke = (n: string, v: number, off = 0) => core.x.zx_poke(sym(n) + off, v);
    poke("_enemy_timer", 1); poke("_enemy_timer", 0, 1);
    for (let i = 0; i < 20 && !rd("_enemy_on"); i++) runFrames(core, 1);
    expect(rd("_enemy_on")).toBe(1);
    poke("_time_left", 2); poke("_time_left", 0, 1);
    runFrames(core, 800);                                            // el parpadeo y la pausa duran unos 8 s
    expect(rd("_lives")).toBe(3);
    expect(rd("_enemy_on")).toBe(0);
    expect(rd("_crosshair", 10)).toBe(1);
  });

  it("al abatir el enemigo número 20 se pasa al nivel 2 y se pide ENTER", async () => {
    const { core, tap } = await boot("sootland-c");
    const { sym } = engineC();
    const rd = (n: string, off = 0) => core.ram()[sym(n) + off]!;
    const poke = (n: string, v: number, off = 0) => core.x.zx_poke(sym(n) + off, v);
    poke("_enemy_timer", 1); poke("_enemy_timer", 0, 1);
    for (let i = 0; i < 20 && !rd("_enemy_on"); i++) runFrames(core, 1);
    poke("_wave", 19);
    poke("_scene", rd("_enemy_scene"));
    poke("_crosshair", rd("_enemy", 6), 6); poke("_crosshair", rd("_enemy", 7), 7);
    press(core, [KEY.SPACE], 30); runFrames(core, 5);
    expect(rd("_level")).toBe(2);
    // Con la pantalla del nivel pedida, ENTER carga la cabecera del nivel 2 (se verá en CA38h).
    press(core, [[6, 0]], 10); runFrames(core, 1500);
    expect(h(core.ram().subarray(0xca38, 0xca38 + 1222))).toBe(h(tapBlocks(tap)[7]!.subarray(1, -1)));
  });
});
