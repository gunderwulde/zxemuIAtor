// E1, aceptación (PLAN.md): el TAP exportado, cargado en el emulador real con LOAD "",
// ejecuta el programa. Oráculo: la propia ROM (LOAD, CLEAR, informes, variables del
// sistema) y la fuente de la ROM para leer la pantalla. Más el round-trip SNA.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { assemble } from "../../web/src/asm";
import { Core } from "../../web/src/emu/core";
import { PROG_START, buildTap } from "../../web/src/export/tap";
import { bootToEditor } from "../../web/src/ui/run";
import { hasRealCpu, runFrames, typeLoad } from "../core/tape/tap";
import { screenLines } from "../util/screen";
import { ROOT, instantiate, rom48 } from "../util/wasm";

const ERR_NR = 0x5c3a, BORDCR = 0x5c48, RAMTOP = 0x5cb2, PROG = 0x5c53, STKEND = 0x5c65;
const REPORT_OK = 0xff;          // ERR_NR = código − 1: "0 OK"
const REPORT_M = 0x15;           // M RAMTOP no good (informe 22)
const REPORT_4 = 0x03;           // 4 Out of memory

let core: Core;
let cpu = false;
beforeAll(async () => {
  core = new Core(await instantiate("core-probe"));
  core.loadRom(rom48());
  cpu = hasRealCpu(core);
});

const peek16 = (a: number) => core.ram()[a]! | (core.ram()[a + 1]! << 8);

/** Arranca la ROM, inserta la cinta, teclea LOAD "" y deja correr. */
function loadAndRun(tap: Uint8Array, frames = 150) {
  core.x.zx_reset();
  runFrames(core, 150);
  expect(core.loadTap(tap)).toBe(0);
  typeLoad(core);
  runFrames(core, frames);
}

function asm(src: string) {
  const r = assemble(src);
  expect(r.errors.filter((e) => e.severity === "error")).toEqual([]);
  return r;
}

describe("TAP exportado en el emulador real", () => {
  it("hello.asm: LOAD \"\" carga, ejecuta y vuelve con 0 OK", (ctx) => {
    if (!cpu) ctx.skip();
    const src = readFileSync(join(ROOT, "web/src/asm/examples/hello.asm"), "utf8");
    const a = asm(src);
    const { tap } = buildTap(a.segments, a.entry, "hello");
    loadAndRun(tap!);
    const s = a.segments[0]!;
    expect(Array.from(core.ram().subarray(s.addr, s.addr + s.bytes.length))).toEqual(Array.from(s.bytes));
    expect(peek16(RAMTOP)).toBe(0x7fff);            // CLEAR 32767
    expect(core.ram()[BORDCR]).toBe(1 * 8 + 7);     // lo escribe el programa
    expect(core.ram()[ERR_NR]).toBe(REPORT_OK);
    expect(screenLines(core.ram())[10]!.slice(9, 21)).toBe("Hola, mundo!");
    // Borde azul (docs §3: índice 1) en el framebuffer: esquina superior izquierda.
    const fb = core.framebuffer();
    expect([fb[0]! < 64, fb[1]! < 64, fb[2]! > 128]).toEqual([true, true, true]);
  });

  it("varios segmentos (pantalla + código + datos): todos en su sitio y la pantalla intacta", (ctx) => {
    if (!cpu) ctx.skip();
    const a = asm(`
        org 4000h
        ds 6144, 0AAh        ; todos los píxeles de la pantalla
        org 0C000h
data:   db 11h, 22h, 33h
        org 9000h
start:  ld a,(data+1)
        ld (0A000h),a
        ld a,4
        out (0FEh),a
        ret
        end start`);
    expect(a.segments).toHaveLength(3);
    const { tap, clear } = buildTap(a.segments, a.entry, "multi");
    expect(clear).toBe(0x8fff);
    loadAndRun(tap!);
    expect(core.ram()[0xa000]).toBe(0x22);            // el código ha corrido y leyó los datos
    expect(Array.from(core.ram().subarray(0xc000, 0xc003))).toEqual([0x11, 0x22, 0x33]);
    // La pantalla se carga la última, así que los "Bytes: multi" de la ROM no la pisan (con
    // los bloques en orden ascendente este test falla). El "0 OK" final escribe en las
    // dos líneas inferiores: se mira sólo el tercio superior.
    expect(core.ram().subarray(0x4000, 0x4800).every((b) => b === 0xaa)).toBe(true);
    expect(peek16(RAMTOP)).toBe(0x8fff);
    expect(core.ram()[ERR_NR]).toBe(REPORT_OK);
  });

  it("límite de CLEAR: el mínimo de buildTap carga; con menos hueco la ROM da 4 o M", (ctx) => {
    if (!cpu) ctx.skip();
    // Mínimo admitido: el primer inicio sin error de buildTap (busca hacia arriba).
    let lo = 0x5c00;
    while (buildTap([{ addr: lo, bytes: Uint8Array.of(0xc9) }], lo, "x").tap === null) lo++;
    const ok = buildTap([{ addr: lo, bytes: Uint8Array.of(0xc9) }], lo, "x");
    loadAndRun(ok.tap!);
    expect(core.ram()[ERR_NR]).toBe(REPORT_OK);
    expect(peek16(RAMTOP)).toBe(lo - 1);
    // Con el cargador cargado, STKEND es el que supone buildTap (PROG + programa + 3).
    const progLen = (ok.tap![21]! | (ok.tap![22]! << 8)) - 2; // bloque de datos = programa + 2
    expect(peek16(PROG)).toBe(PROG_START);
    expect(peek16(STKEND)).toBe(PROG_START + progLen + 3);

    // El mismo cargador con otro CLEAR (mismo número de dígitos: se cambian los dígitos,
    // la forma de 5 bytes y el checksum del bloque).
    const withClear = (n: number) => {
      const t = ok.tap!.slice();
      const prog = 24, digits = prog + 5;          // tras 00 0A len len FD
      const txt = String(n);
      expect(txt.length).toBe(String(lo - 1).length);
      for (let i = 0; i < 5; i++) t[digits + i] = txt.charCodeAt(i);
      t[digits + 5 + 3] = n & 0xff;
      t[digits + 5 + 4] = n >> 8;
      let x = 0xff;
      for (let i = 0; i < progLen; i++) x ^= t[prog + i]!;
      t[prog + progLen] = x;
      return t;
    };
    loadAndRun(withClear(lo - 2));                  // un byte menos de pila: TEST-ROOM
    expect(core.ram()[ERR_NR]).toBe(REPORT_4);
    loadAndRun(withClear(lo - 1 - 100));            // CLEAR n ≤ STKEND+50
    expect(core.ram()[ERR_NR]).toBe(REPORT_M);
  });
});

describe("SNA", () => {
  it("round-trip: guardar, cargar en un núcleo nuevo y volver a guardar da el mismo estado", async (ctx) => {
    if (!cpu) ctx.skip();
    core.x.zx_reset();
    expect(bootToEditor(core)).toBe(true);
    // Algo de estado propio: borde, RAM alta y registros alternos.
    for (const [i, b] of [0x3e, 0x05, 0xd3, 0xfe, 0xd9, 0x21, 0x34, 0x12, 0xd9, 0x18, 0xfe].entries()) core.x.zx_poke(0xa000 + i, b);
    core.x.zx_set_pc(0xa000);
    for (let i = 0; i < 5; i++) core.x.zx_step();
    const before = core.regs.snapshot();
    const ram = core.ram().slice(0x4000);
    const sna = core.saveSna();
    expect(sna.length).toBe(49179);
    // Guardar no altera la máquina.
    expect(core.regs.snapshot()).toEqual(before);
    expect(core.ram().slice(0x4000)).toEqual(ram);

    const other = new Core(await instantiate("core"));
    other.loadRom(rom48());
    expect(other.loadSna(sna)).toBe(0);
    const after = other.regs.snapshot();
    for (const r of ["af", "bc", "de", "hl", "af_", "bc_", "de_", "hl_", "ix", "iy", "sp", "pc", "i", "r", "im", "iff2"] as const) {
      expect([r, after[r]]).toEqual([r, before[r]]);
    }
    expect(after.iff1).toBe(before.iff2);           // el formato sólo guarda IFF2
    expect(after.hl_).toBe(0x1234);
    // RAM idéntica salvo los dos bytes bajo SP, donde el formato guarda el PC.
    const sp = before.sp;
    const r2 = other.ram().slice(0x4000);
    r2[sp - 2 - 0x4000] = ram[sp - 2 - 0x4000]!;
    r2[sp - 1 - 0x4000] = ram[sp - 1 - 0x4000]!;
    expect(r2).toEqual(ram);
    expect(Array.from(other.saveSna())).toEqual(Array.from(sna));
    // Borde: el último OUT del programa (5 = cian) en el framebuffer de ambos.
    other.runFrame();
    core.runFrame();
    expect(Array.from(other.framebuffer().subarray(0, 4))).toEqual(Array.from(core.framebuffer().subarray(0, 4)));
    expect(sna[26]).toBe(5);
  });
});
