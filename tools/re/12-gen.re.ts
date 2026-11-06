// Genera el proyecto de ejemplo de Sootland (web/src/examples/sootland/) a partir de la cinta
// original y de sootland-names.ts, y comprueba que el proyecto reconstruye la cinta idéntica.
//   npx vitest run --config vitest.re.config.ts tools/re/12-gen.re.ts
import { expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../tests/util/wasm";
import { registerResource, unregisterResource } from "../../web/src/res/registry";
import { encodeScrDoc, scrResource } from "../../web/src/res/scr";
import { newTileSet, serializeTileSet, tilesResource, type Tile } from "../../web/src/res/tiles";
import { tapeResource } from "../../web/src/res/tape";
import { TabsModel } from "../../web/src/ui/tabs/model";
import { buildProject } from "../../web/src/ui/tabs/project";
import { WORK, readTzx, tapBlocks, tzxToTap } from "./common";
import { lift, ROM_NAMES, SYSVARS, type Names, type Region } from "./lift";
import { ENGINE, ENGINE_EXTERNS, FINAL, LOADER } from "./sootland-names";

const OUT = join(ROOT, "web", "src", "examples", "sootland");
const blk = (n: string) => new Uint8Array(readFileSync(join(WORK, n))).subarray(1, -1);   // sin flag ni checksum
const hex4 = (n: number) => `0${n.toString(16).toUpperCase().padStart(4, "0")}h`;
const hex2 = (n: number) => `0${n.toString(16).toUpperCase().padStart(2, "0")}h`;

const A = blk("blk-s1-3.bin"), B = blk("blk-s1-4.bin"), F = blk("blk-s2-8.bin");
const LEVEL_HDR = [0, 2, 4, 6].map((i) => blk(`blk-s2-${i}.bin`));
const LEVEL_BODY = [1, 3, 5, 7].map((i) => blk(`blk-s2-${i}.bin`));

// ---- Recursos ----
const files = new Map<string, string>();
const tilesDoc = (bytes: Uint8Array): string => {
  const ts = newTileSet(8);
  ts.tiles = [];
  for (let i = 0; i < bytes.length; i += 8) {
    const t: Tile = { pix: [], atr: [0x38], props: 0, val: 0, name: "" };
    for (let y = 0; y < 8; y++) t.pix.push([...bytes[i + y]!.toString(2).padStart(8, "0")].map((c) => (c === "1" ? "X" : ".")).join(""));
    ts.tiles.push(t);
  }
  return serializeTileSet(ts);
};
const scrDoc = (px: Uint8Array, attrs: Uint8Array, bottom: boolean): string => {
  const s = new Uint8Array(6912);
  s.set(px, bottom ? 4096 : 0);
  s.set(attrs, 6144 + (bottom ? 512 : 0));
  return encodeScrDoc(s);
};

files.set("hud.scr", scrDoc(B.subarray(0, 0x800), B.subarray(0x800, 0x900), true));
files.set("font.tiles", tilesDoc(B.subarray(0x900, 0xc00)));
files.set("sprites.tiles", tilesDoc(B.subarray(0xc00, 0x12e8)));
const BG = "abcd";
for (let l = 0; l < 4; l++) {
  files.set(`lvl${l + 1}.tiles`, tilesDoc(LEVEL_HDR[l]!.subarray(0, 0x408)));
  for (let n = 0; n < 4; n++) {
    const c = LEVEL_BODY[l]!.subarray(n * 0x1200, (n + 1) * 0x1200);
    files.set(`l${l + 1}${BG[n]}.scr`, scrDoc(c.subarray(0, 4096), c.subarray(4096), false));
  }
}

// ---- Ensamblador ----
const equ = (ex: Map<number, string>, skip: Set<string>) =>
  [...ex].filter(([, n]) => !skip.has(n)).sort((a, b) => a[0] - b[0]).map(([a, n]) => `${n.padEnd(14)} equ ${hex4(a)}`).join("\n");

/** Etiquetas del diccionario que caen en [lo, hi) (direcciones lógicas = físicas). */
const sub = (n: Names, lo: number, hi: number): Names => ({
  labels: Object.fromEntries(Object.entries(n.labels ?? {}).filter(([a]) => +a >= lo && +a < hi)),
  comments: Object.fromEntries(Object.entries(n.comments ?? {}).filter(([a]) => +a >= lo && +a < hi)),
  words: Object.fromEntries(Object.entries(n.words ?? {}).filter(([a]) => +a >= lo && +a < hi)),
  strings: n.strings, code: n.code,
});

const HEADER = (title: string, what: string) =>
  `; ${title}\n; ${what}\n; © 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso.\n` +
  `; Gráficos: Alberto Herraiz y Fernando Pérez. Música: J. Torres.\n` +
  `; Reconstruido por ingeniería inversa de la cinta original e incluido con permiso de su autor.\n`;

function liftAll(regions: Array<{ r: Region; names: Names }>, ext: Map<number, string>) {
  const texts: string[] = [], externs = new Map<number, string>(), defined = new Set<string>();
  for (const { r, names } of regions) {
    const res = lift(r, names, ext);
    texts.push(res.text);
    for (const [a, n] of res.externs) externs.set(a, n);
    for (const n of res.labels.values()) defined.add(n);
  }
  return { text: texts.join("\n"), externs, defined };
}

// loader.asm: A en tres tramos (código y datos hasta el stub; el stub reubicado en AFC8h; resto).
const STUB_AT = 0xf0f2, STUB_LEN = 0x38, A_BASE = 0xafc8;
const aSlice = (lo: number, hi: number) => A.slice(lo - A_BASE, hi - A_BASE);
const loaderExt = new Map<number, string>(Object.entries(LOADER.labels ?? {}).map(([a, n]) => [+a, n]));
const loaderParts = liftAll([
  { r: { name: "A1", bytes: aSlice(A_BASE, STUB_AT), phys: A_BASE, run: A_BASE, seeds: [0xea60, 0xafc8] }, names: sub(LOADER, A_BASE, STUB_AT) },
  { r: { name: "stub", bytes: aSlice(STUB_AT, STUB_AT + STUB_LEN), phys: STUB_AT, run: A_BASE, seeds: [A_BASE], prefix: "stub_" },
    names: { labels: { [A_BASE]: "stub_start" }, comments: { [A_BASE]: LOADER.comments![0xf0f2]! } } },
  { r: { name: "A3", bytes: aSlice(STUB_AT + STUB_LEN, A_BASE + A.length), phys: STUB_AT + STUB_LEN, run: STUB_AT + STUB_LEN, seeds: [] },
    names: { labels: { [STUB_AT + STUB_LEN]: "leftover" }, comments: { [STUB_AT + STUB_LEN]: "Relleno: restos de memoria que se grabaron con el bloque (ceros, un trozo de BASIC y de la fuente). No se usa." } } },
], loaderExt);
const romEqu = (ex: Map<number, string>) => new Map([...ex].filter(([a]) => ROM_NAMES[a] !== undefined || SYSVARS[a] !== undefined));
files.set("loader.asm",
  HEADER("Sootland — loader.bin", "Bloque A de la cinta (CODE en AFC8h): música, menú de la intro y cargador del motor.") + "\n" +
  "; Dónde está grabado el stub (se ejecuta reubicado en AFC8h, ver PHASE más abajo).\nstub_loader   equ 0F0F2h\n" +
  equ(romEqu(loaderParts.externs), loaderParts.defined) + "\n\n" + loaderParts.text);

// engine.asm: tres piezas que el stub reparte (PHASE) y el motor en su sitio.
const engineB4 = liftAll([
  { r: { name: "B4", bytes: B.slice(0x12e8), phys: 0xea60, run: 0xea60, seeds: [0xea60, 0xea8d] }, names: ENGINE },
], ENGINE_EXTERNS);
const MANUAL = new Set(["hud_gfx", "hud_attrs"]);
files.set("engine.asm",
  HEADER("Sootland — motor", "Bloque B de la cinta (sin cabecera, 10370 bytes en D778h): marco, fuente, sprites y código del juego.") +
  "\n; Direcciones que el motor usa fuera de sí mismo.\n" +
  equ(new Map([...ENGINE_EXTERNS, ...romEqu(engineB4.externs)]), MANUAL) + "\nhud_attrs      equ 0D708h\n\n" +
  " org 0D778h\n" +
  "; El stub de carga (loader.asm) reparte el bloque con tres LDIR; PHASE da a cada pieza la dirección a la que\n" +
  "; se copia, así que las etiquetas valen en ejecución. Las tres son recursos editables.\n\n" +
  "; Pieza 1 → CF08h: tercio inferior de la pantalla (2048 bytes) y sus atributos (256): el marco de marcadores.\n" +
  " phase 0CF08h\nhud_gfx:\n incbin \"hud.scr#bottom\"\n dephase\n\n" +
  "; Pieza 2 → DD00h: fuente de 96 caracteres (CHARS = DC00h).\n" +
  " phase 0DD00h\nfont:\n incbin \"font.tiles\"\n dephase\n\n" +
  "; Pieza 3 → C350h: celdas de 8×8 de los sprites comunes (gráficos y máscaras; ver sprite_draw).\n" +
  " phase 0C350h\nsprites:\n incbin \"sprites.tiles\"\n dephase\n\n" +
  "; Pieza 4: el código del juego, que se queda donde se cargó.\n" + engineB4.text);

// finalN.asm
const finalPart = liftAll([{ r: { name: "F", bytes: F, phys: 0xc350, run: 0xc350, seeds: [0xce72] }, names: FINAL }], new Map());
files.set("final.asm",
  HEADER("Sootland — final", "Último bloque de la cinta (cara 2, sin cabecera, 3292 bytes en C350h).") + "\n" +
  equ(romEqu(finalPart.externs), finalPart.defined) + "\n\n" + finalPart.text);

// levelN.asm: cabecera (sprites + tablas) y cuerpo (4 fondos).
const dwRef = (lo: number, hi: number, base: string) => (a: number) =>
  a >= lo && a < hi ? (a === lo ? base : `${base}+${hex4(a - lo)}`) : hex4(a);
for (let l = 0; l < 4; l++) {
  const h = LEVEL_HDR[l]!;
  const ref = dwRef(0xca38, 0xce40, "level_header");
  const rows = (lo: number, n: number, per: number, fmt: (r: Uint8Array) => string) => {
    const out: string[] = [];
    for (let i = 0; i < n; i += per) out.push(fmt(h.subarray(lo - 0xca38 + i, lo - 0xca38 + i + per)));
    return out.join("\n");
  };
  const actor = (r: Uint8Array) => ` db ${hex2(r[0]!)},${hex2(r[1]!)},${hex2(r[2]!)},${hex2(r[3]!)}\n dw ${ref(r[4]! | (r[5]! << 8))},${ref(r[6]! | (r[7]! << 8))}`;
  const spawn = (r: Uint8Array) => ` db ${[...r].map(hex2).join(",")}`;
  const body = [0, 1, 2, 3].map((n) => `bg${n + 1}:\n incbin "l${l + 1}${BG[n]}.scr#top"`).join("\n");
  files.set(`level${l + 1}.asm`,
    HEADER(`Sootland — nivel ${l + 1}`, `Cabecera (flag ${l + 1}) y cuerpo (flag ${l + 5}) que el motor carga con LD-BYTES al empezar el nivel.`) +
    "\n; Cabecera: 1222 bytes en CA38h.\n org 0CA38h\nlevel_header:\n" +
    `; 129 celdas de 8×8 con los sprites de este nivel (enemigos y actores, con sus máscaras).\n incbin "lvl${l + 1}.tiles"\n\n` +
    "; Actores: 8 entradas de 8 bytes (escena, columna, fila, tipo, puntero al gráfico, puntero a la máscara).\nlvl_actors:\n" +
    rows(0xce40, 64, 8, actor) + "\n\n; Sin usar.\n ds 36\n\n" +
    "; Apariciones de enemigos: registros de 3 bytes (escena, columna, fila); el juego usa 16.\nlvl_spawns:\n" + rows(0xcea4, 90, 6, spawn) + "\n\n" +
    "; Cuerpo: 18432 bytes en 61A8h = 4 fondos de 4608 (128 líneas de bitmap + 16 filas de atributos), uno por escena.\n" +
    " org 61A8h\nlevel_body:\n" + body + "\n");
}

// Manifiesto.
const tape = {
  v: 1, name: "Sootland",
  blocks: [
    { type: "basic", name: "SHOOT", autostart: 10, source: '10 CLEAR 24999\n20 LOAD "loader.bin" CODE\n30 LET l=USR 60000' },
    { type: "code", name: "loader.bin", src: "loader.asm", addr: "0xAFC8", len: A.length, param2: 32887 },
    { type: "data", flag: 255, src: "engine.asm", addr: "0xD778", len: B.length },
    ...[1, 2, 3, 4].flatMap((n) => [
      { type: "data", flag: n, src: `level${n}.asm`, addr: "0xCA38", len: 1222 },
      { type: "data", flag: n + 4, src: `level${n}.asm`, addr: "0x61A8", len: 18432 },
    ]),
    { type: "data", flag: 255, src: "final.asm", addr: "0xC350", len: F.length },
  ],
};
files.set("sootland.tape", JSON.stringify(tape, null, 1));

const ORDER = ["sootland.tape", "loader.asm", "engine.asm", "level1.asm", "level2.asm", "level3.asm", "level4.asm", "final.asm",
  "hud.scr", "font.tiles", "sprites.tiles", ...[1, 2, 3, 4].flatMap((l) => [`lvl${l}.tiles`, ...[...BG].map((c) => `l${l}${c}.scr`)])];

it("genera el proyecto y reconstruye la cinta", () => {
  mkdirSync(OUT, { recursive: true });
  for (const [n, t] of files) writeFileSync(join(OUT, n), t);
  writeFileSync(join(OUT, "project.json"), JSON.stringify({
    name: "Sootland", title: "Sootland (Zafiro, 1988): juego completo reconstruido",
    main: "sootland.tape", active: "sootland.tape", files: ORDER,
  }, null, 1));
  expect([...files.keys()].sort()).toEqual([...ORDER].sort());

  registerResource(scrResource); registerResource(tilesResource); registerResource(tapeResource);
  try {
    const m = TabsModel.initial("", "");
    m.close(m.find("main.c")!.id);
    for (const n of ORDER) m.add(n, files.get(n)!);
    const r = buildProject(m, m.find("sootland.tape")!);
    const msgs = r.messages.filter((x) => x.severity === "error").map((x) => x.text);
    expect(msgs.slice(0, 8)).toEqual([]);
    const orig = [...tapBlocks(tzxToTap(readTzx("Sootland - Side 1.tzx"))), ...tapBlocks(tzxToTap(readTzx("Sootland - Side 2.tzx")))];
    const mine = tapBlocks([...r.tap!]);
    expect(mine.length).toBe(orig.length);
    const bad: string[] = [];
    orig.forEach((b, i) => {
      const x = mine[i]!;
      if (x.length !== b.length) { bad.push(`bloque ${i}: ${x.length} bytes en vez de ${b.length}`); return; }
      for (let k = 0; k < b.length; k++) if (x[k] !== b[k]) { bad.push(`bloque ${i}: primer byte distinto en +${k}`); return; }
    });
    expect(bad).toEqual([]);
  } finally { unregisterResource("scr"); unregisterResource("tiles"); unregisterResource("tape"); }
});
