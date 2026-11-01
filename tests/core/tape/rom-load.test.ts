// SYS-04 (docs/TEST-PLAN.md): LOAD de la ROM con trampa y TAP sintético.
// Oráculo: la propia ROM (variables del sistema PROG/VARS/ERR_NR) y los datos del TAP.
import { beforeAll, describe, expect, it } from "vitest";
import { Core } from "../../../web/src/emu/core";
import { instantiate, rom48 } from "../../util/wasm";
import { KEY, hasRealCpu, header, press, runFrames, tap, tapBlock, typeLoad } from "./tap";

const ERR_NR = 0x5c3a, PROG = 0x5c53, VARS = 0x5c4b;

let core: Core;
let cpu = false;
beforeAll(async () => {
  core = new Core(await instantiate("core-probe"));
  core.loadRom(rom48());
  cpu = hasRealCpu(core);
  if (!cpu) console.warn("[M3] z80.c es el stub: se salta SYS-04");
});

const peek16 = (a: number) => core.ram()[a]! | (core.ram()[a + 1]! << 8);

function boot(t: Uint8Array) {
  core.x.zx_reset();
  runFrames(core, 150);
  expect(core.loadTap(t)).toBe(0);
}

// 10 PRINT 1   (número en formato de 5 bytes: 0E 00 00 01 00 00)
const PROGRAM = [0x00, 0x0a, 0x09, 0x00, 0xf5, 0x31, 0x0e, 0x00, 0x00, 0x01, 0x00, 0x00, 0x0d];

describe("SYS-04 LOAD por trampa", () => {
  it("LOAD \"\" de un programa BASIC: aparece en PROG y la ROM acaba en 0 OK", (ctx) => {
    if (!cpu) ctx.skip();
    boot(tap(tapBlock(0x00, header(0, "prog", PROGRAM.length, 0x8000, PROGRAM.length)), tapBlock(0xff, PROGRAM)));
    typeLoad(core);
    runFrames(core, 50);
    const prog = peek16(PROG);
    expect(Array.from(core.ram().subarray(prog, prog + PROGRAM.length))).toEqual(PROGRAM);
    expect(peek16(VARS)).toBe(prog + PROGRAM.length);
    expect(core.ram()[ERR_NR]).toBe(0xff);     // 0 OK
  });

  it("LOAD \"\" CODE: memoria idéntica en la dirección de la cabecera", (ctx) => {
    if (!cpu) ctx.skip();
    const data = Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 0xff);
    boot(tap(tapBlock(0x00, header(3, "code", data.length, 0x9000, 0x8000)), tapBlock(0xff, data)));
    press(core, [KEY.J]);
    press(core, [KEY.SYM, KEY.P]);
    press(core, [KEY.SYM, KEY.P]);
    press(core, [KEY.CAPS, KEY.SYM]);       // modo E
    press(core, [[5, 2]]);                  // I → CODE
    press(core, [KEY.ENTER]);
    runFrames(core, 50);
    expect(Array.from(core.ram().subarray(0x9000, 0x9000 + data.length))).toEqual(data);
    expect(core.ram()[0x9000 + data.length]).toBe(0);
    expect(core.ram()[ERR_NR]).toBe(0xff);
  });

  it("flag erróneo en el bloque de datos → R Tape loading error", (ctx) => {
    if (!cpu) ctx.skip();
    boot(tap(tapBlock(0x00, header(0, "prog", PROGRAM.length, 0x8000, PROGRAM.length)), tapBlock(0x00, PROGRAM)));
    typeLoad(core);
    runFrames(core, 50);
    expect(core.ram()[ERR_NR]).toBe(0x1a);     // código de informe R (27) − 1
  });

  it("checksum erróneo → R Tape loading error", (ctx) => {
    if (!cpu) ctx.skip();
    boot(tap(tapBlock(0x00, header(0, "prog", PROGRAM.length, 0x8000, PROGRAM.length)), tapBlock(0xff, PROGRAM, 0x55)));
    typeLoad(core);
    runFrames(core, 50);
    expect(core.ram()[ERR_NR]).toBe(0x1a);
  });
});
