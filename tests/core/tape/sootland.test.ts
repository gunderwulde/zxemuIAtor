// M3 — caso real: Sootland ("Shoot Land", Zafiro 1988), juego del usuario.
// Los ficheros están en tests/fixtures-local/sootland/ (no versionados): si faltan, o si
// la CPU todavía es el stub, el test se salta con aviso.
//
// Hay dos cintas:
//  - SHOTLAND.TAP (1996): NO es la cinta original sino un volcado de un snapshot .Z80
//    de 128K con un cargador BASIC ("Loading .Z80 emulator snapshot"). Los bloques
//    "0        0".."0        6" llevan en p1 el número de banco 128K (0,1,2,3,4,6,7) y
//    el cargador hace OUT (0x7FFD),p1|0x10 antes de cargarlos todos en 0xC000; p1 = 8
//    sería la página 0x8000 de un snapshot 48K y p1 & 0xFF = 0x0A (16138 = 0x3F0A) el
//    bloque final de 16 KB en 0x4000, que se carga con CALL 0x0562 (el byte alto, 0x3F,
//    va al registro I). La vuelta sale de los propios datos cargados (pila en 0x57E4):
//    0x55E0, que restaura AY (0xBFFD/0xFFFD) y paginación. En un 48K real el paginado
//    no existe: los siete bancos se pisan en 0xC000 y 0x8000-0xBFFF nunca se carga, así
//    que el juego acaba ejecutando ceros y se reinicia. El test comprueba la mecánica de
//    carga (trampa en 0x0556 y en 0x056B) y ese desenlace.
//  - Sootland - Side 1/2.tzx: la cinta original, sólo con bloques estándar de la ROM
//    (TZX 0x10), que se convierten aquí a TAP sin pérdida para la ROM. Con ella el juego
//    llega a la partida y el marcador coincide con Sootland-ingame.gif.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Core, STOP } from "../../../web/src/emu/core";
import { instantiate, ROOT, rom48 } from "../../util/wasm";
import { decodeGif } from "./gif";
import { KEY, hasRealCpu, press, runFrames, typeLoad } from "./tap";

const DIR = join(ROOT, "tests", "fixtures-local", "sootland");
const file = (n: string) => (existsSync(join(DIR, n)) ? new Uint8Array(readFileSync(join(DIR, n))) : null);

let core: Core;
let cpu = false;
beforeAll(async () => {
  core = new Core(await instantiate("core-probe"));
  core.loadRom(rom48());
  cpu = hasRealCpu(core);
});

function boot(tape: Uint8Array) {
  core.x.zx_reset();
  runFrames(core, 150);                       // la ROM llega al cursor K
  expect(core.loadTap(tape)).toBe(0);
}

/** Bloques TAP: [len16][flag…checksum]. */
function tapBlocks(t: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let p = 0; p < t.length;) {
    const n = t[p]! | (t[p + 1]! << 8);
    out.push(t.subarray(p + 2, p + 2 + n));
    p += 2 + n;
  }
  return out;
}

/** TZX → TAP: sólo bloques 0x10 (velocidad estándar, idénticos a un bloque TAP) y
 *  metadatos (0x30 texto, 0x32 archivo). Cualquier otro tipo es un error. */
function tzxToTap(b: Uint8Array): number[] {
  if (String.fromCharCode(...b.subarray(0, 7)) !== "ZXTape!") throw new Error("no es TZX");
  const out: number[] = [];
  for (let p = 10; p < b.length;) {
    const id = b[p]!;
    if (id === 0x10) {
      const n = b[p + 3]! | (b[p + 4]! << 8);
      out.push(n & 0xff, n >> 8, ...b.subarray(p + 5, p + 5 + n));
      p += 5 + n;
    } else if (id === 0x30) p += 2 + b[p + 1]!;
    else if (id === 0x32) p += 3 + (b[p + 1]! | (b[p + 2]! << 8));
    else throw new Error(`bloque TZX 0x${id.toString(16)} no soportado`);
  }
  return out;
}

interface Call { pc: number; ix: number; de: number; a: number; frame: number }

/** Ejecuta frames registrando las paradas en 'bps'; tras cada parada continúa. */
function runWatching(frames: number, bps: number[], until?: (c: Call) => boolean): Call[] {
  const calls: Call[] = [];
  core.x.zx_bp_clear_all();
  for (const a of bps) core.x.zx_bp_set(a, 1);
  const f0 = core.x.zx_frame_count();
  while (core.x.zx_frame_count() - f0 < frames) {
    if (core.runFrame() !== STOP.BREAKPOINT) continue;
    const r = core.regs.snapshot();
    const c = { pc: r.pc, ix: r.ix, de: r.de, a: r.af >> 8, frame: core.x.zx_frame_count() - f0 };
    calls.push(c);
    if (until?.(c)) break;
  }
  core.x.zx_bp_clear_all();
  return calls;
}

describe("SHOTLAND.TAP (snapshot 128K en cinta)", () => {
  const tape = file("SHOTLAND.TAP");

  it("carga: todo por trampa (el bloque de 0x0562 en LD-BREAK, 0x056B); en 48K luego se reinicia", (ctx) => {
    if (!tape) { console.warn("[M3] falta tests/fixtures-local/sootland/SHOTLAND.TAP: se salta"); ctx.skip(); }
    if (!cpu) { console.warn("[M3] z80.c es el stub: se salta Sootland"); ctx.skip(); }
    const blocks = tapBlocks(tape!);
    boot(tape!);
    // LOAD "" sin el ENTER final, que se pulsa ya vigilando LD-BYTES: la ROM carga
    // "Loader" por trampa y lo ejecuta (RANDOMIZE USR 23867).
    press(core, [KEY.J]);
    press(core, [KEY.SYM, KEY.P]);
    press(core, [KEY.SYM, KEY.P]);
    core.x.zx_key(KEY.ENTER[0], KEY.ENTER[1], 1);
    const basic = runWatching(4, [0x0556]);
    core.x.zx_key(KEY.ENTER[0], KEY.ENTER[1], 0);

    // 1) El BASIC (LOAD de la ROM), siete pares cabecera + datos con LD-BYTES (0x0556)
    //    y la cabecera final, todos por trampa: DE = 17 o la longitud de la cabecera anterior. 2) CALL 0x0562 del bloque
    //    de 16 KB: lo resuelve la trampa de LD-BREAK (0x056B), como en Fuse.
    const calls = [...basic, ...runWatching(400, [0x0556, 0x0562], (c) => c.pc === 0x0562)];
    const lds = calls.filter((c) => c.pc === 0x0556);
    const expected = [17, 400, 17, 3112, 17, 310, 17, 1895, 17, 310, 17, 310, 17, 310, 17, 377, 17];
    expect(lds.map((c) => c.de)).toEqual(expected);
    const last = calls[calls.length - 1]!;
    expect(last.pc).toBe(0x0562);
    expect([last.ix, last.de]).toEqual([0x4000, 0x4000]);

    // El bloque de 16 KB (por pulsos serían ~50 s de cinta) se carga al instante.
    // Vuelve por RET a lo que los datos dejaron en 0x57E4: 0x55E0, con carry y DE = 0.
    const ret = runWatching(4000, [0x55e0], () => true);
    expect(ret.length, "el bloque de 0x4000 debe acabar de cargar").toBe(1);
    const r = core.regs.snapshot();
    expect(r.af & 1).toBe(1);
    expect(r.de).toBe(0);
    expect(r.ix).toBe(0x8000);
    // RAM = datos del bloque, salvo los 4 bytes bajo SP (0x57E0-0x57E3): leyendo pulsos
    // los pisan los CALL de LD-EDGE/LD-8-BITS (también en la máquina real); la trampa no.
    const got = core.ram().slice(0x4000, 0x8000), want = blocks[17]!.slice(1, 16385);
    got.fill(0, 0x17e0, 0x17e4);
    want.fill(0, 0x17e0, 0x17e4);
    expect(got).toEqual(want);

    // En 48K: el restaurador salta al juego con 0x8000-0xBFFF sin cargar → NOPs hasta
    // 0xFFFF → 0x0000 (reset). Es lo que haría un Spectrum 48K real con esta cinta.
    const reset = runWatching(1000, [0x0000], () => true);
    expect(reset.length, "en 48K el snapshot 128K acaba en 0x0000").toBe(1);
  });
});

describe("cinta original (TZX → TAP)", () => {
  const s1 = file("Sootland - Side 1.tzx"), s2 = file("Sootland - Side 2.tzx"), gif = file("Sootland-ingame.gif");

  it("LOAD \"\" → menú → teclado → empezar: multicarga por trampa y partida en marcha", (ctx) => {
    if (!s1 || !s2 || !gif) { console.warn("[M3] faltan los TZX o el GIF de Sootland: se salta"); ctx.skip(); }
    if (!cpu) { console.warn("[M3] z80.c es el stub: se salta Sootland"); ctx.skip(); }
    const tape = Uint8Array.from([...tzxToTap(s1!), ...tzxToTap(s2!)]);
    boot(tape);
    typeLoad(core);          // BASIC "SHOOT" → LOAD "loader.bin" CODE → USR 60000 (todo por trampa)

    // Pantalla de música (AY/beeper con DI y KEY-SCAN): ninguna lectura masiva de EAR,
    // así que la cinta no debe arrancar sola. Dos pulsaciones hasta el menú.
    runFrames(core, 300);
    press(core, [KEY.SPACE], 10);
    runFrames(core, 1000);
    press(core, [KEY.SPACE], 10);
    runFrames(core, 700);
    press(core, [[3, 1]], 10);   // 2: teclado
    runFrames(core, 80);

    // 0: empezar. El juego llama a LD-BYTES para el bloque sin cabecera de la cara A
    // (flag FF, 10372) y el primer nivel de la cara B (flags 01 y 05).
    core.x.zx_key(4, 0, 1);
    const calls = runWatching(400, [0x0556], (c) => c.a === 0x05);
    core.x.zx_key(4, 0, 0);
    expect(calls.map((c) => [c.a, c.ix, c.de])).toEqual([
      [0xff, 0xd778, 10370], [0x01, 0xca38, 1222], [0x05, 0x61a8, 18432],
    ]);
    runFrames(core, 200);         // "REBOBINA LA CARA B Y PULSA PLAY / PULSE ESPACE PARA EMPEZAR"
    press(core, [KEY.SPACE], 10);
    runFrames(core, 300);

    // Marcador (líneas 128-191) frente a la captura de referencia: mismo color de tinta
    // o papel (3 bits, sin brillo) en al menos el 95 % de los píxeles. El escenario de
    // arriba es otra pantalla del nivel y no se compara.
    const g = decodeGif(gif!);
    expect([g.width, g.height]).toEqual([256, 192]);
    const fb = core.framebuffer();
    const cls = (r: number, gg: number, b: number) => (r > 0x60 ? 2 : 0) | (gg > 0x60 ? 4 : 0) | (b > 0x60 ? 1 : 0);
    let same = 0;
    for (let y = 128; y < 192; y++)
      for (let x = 0; x < 256; x++) {
        const o = ((y + 48) * 352 + x + 48) * 4, q = (y * 256 + x) * 3;
        if (cls(fb[o]!, fb[o + 1]!, fb[o + 2]!) === cls(g.rgb[q]!, g.rgb[q + 1]!, g.rgb[q + 2]!)) same++;
      }
    expect(same / (64 * 256)).toBeGreaterThan(0.95);
  });
});
