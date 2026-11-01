// M3 — carga rápida por trampa en LD-BYTES (docs/zx48-hardware.md §10).
//
// Valores esperados: calculados a mano siguiendo el desensamblado de la ROM 48K
// (LD-BYTES 0x0556-0x05E2) para cada caso, y contrastados con la propia ROM leyendo
// pulsos (bloque "ROM real" al final). No salen de tape.c. Donde difieren de lo que
// documenta Fuse (tape_trap_load_block: C = 1, L = último dato, AF' = 0145, B intacto
// al fallar el flag) manda la ROM.
//
// La trampa se dispara con zx_step en PC = 0x0556: zx48.c llama a tape_trap antes de
// ejecutar la instrucción, así que esto no necesita CPU. Los tests "ROM real" sí la
// necesitan y se saltan con aviso mientras z80.c sea el stub.
import { beforeAll, describe, expect, it } from "vitest";
import { Core, STOP } from "../../../web/src/emu/core";
import { instantiate, rom48 } from "../../util/wasm";
import { hasRealCpu, header, runFrames, tap, tapBlock } from "./tap";

const OK = 0, ERR_SIZE = -1, ERR_FORMAT = -2;
const LD_BYTES = 0x0556, LD_RET = 0x05e2, SA_LD_RET = 0x053f;
const SP0 = 0xff00, CALLER = 0x1234;

let core: Core;
let cpu = false;
beforeAll(async () => {
  core = new Core(await instantiate("core-probe"));
  core.loadRom(rom48());
  cpu = hasRealCpu(core);
  if (!cpu) console.warn("[M3] z80.c es el stub: se saltan los tests que ejecutan la ROM");
});

interface Entry { a: number; f: number; de: number; ix: number; bc?: number; hl?: number; af_?: number; inIntWindow?: boolean }

/** Estado de una llamada CALL LD-BYTES desde CALLER. */
function setEntry(e: Entry) {
  const r = core.regs;
  r.set16("af", (e.a << 8) | e.f);
  r.set16("de", e.de);
  r.set16("ix", e.ix);
  r.set16("bc", e.bc ?? 0xaaaa);
  r.set16("hl", e.hl ?? 0x5555);
  r.set16("af_", e.af_ ?? 0x7788);
  r.set16("sp", SP0);
  r.set8("iff1", 1);
  r.set8("iff2", 1);
  core.x.zx_poke(SP0, CALLER & 0xff);
  core.x.zx_poke(SP0 + 1, CALLER >> 8);
  core.x.zx_set_pc(LD_BYTES);
  // Fuera de la ventana de /INT (T 0-31, docs §2): con IFF1 = 1 la INT se aceptaría
  // antes que la trampa (ver "INT pendiente al entrar" más abajo).
  if (!e.inIntWindow) setTstate(1000);
}

const setTstate = (t: number) => (core.x as unknown as { zx_t_set_tstate(t: number): void }).zx_t_set_tstate(t);

function insert(t: Uint8Array) {
  core.x.zx_reset();
  expect(core.loadTap(t)).toBe(OK);
}

function trap(e: Entry) {
  setEntry(e);
  core.x.zx_step();
  expect(core.regs.get16("pc"), "la trampa debe dejar PC en el RET final de LD-BYTES").toBe(LD_RET);
  return core.regs.snapshot();
}

const word = (a: number) => core.ram()[a]! | (core.ram()[a + 1]! << 8);

/** Comprobaciones comunes a toda salida por la trampa entrando en 0x0556. */
function expectFrame() {
  const r = core.regs.snapshot();
  // PUSH HL de 0x055E: SA/LD-RET encima de la dirección de retorno del llamador.
  expect(r.sp).toBe(SP0 - 2);
  expect(word(SP0 - 2)).toBe(SA_LD_RET);
  expect(word(SP0)).toBe(CALLER);
  expect(r.iff1).toBe(0);  // DI de 0x0559; SA/LD-RET hace EI
  expect(r.iff2).toBe(0);
}

const DATA = [1, 2, 3, 4, 5];           // checksum FF^1^2^3^4^5 = FE

describe("zx_load_tap", () => {
  it("valida las longitudes de bloque", () => {
    expect(core.loadTap(new Uint8Array(0))).toBe(ERR_SIZE);
    expect(core.loadTap(Uint8Array.from([5]))).toBe(ERR_FORMAT);
    expect(core.loadTap(Uint8Array.from([7, 0, 0xff, 1, 2]))).toBe(ERR_FORMAT);
    expect(core.loadTap(tap(tapBlock(0xff, DATA), [3, 0, 1]))).toBe(ERR_FORMAT);
    expect(core.loadTap(tap(tapBlock(0xff, DATA), [0, 0], tapBlock(0, header(3, "x", 1, 2, 3))))).toBe(OK);
  });
});

describe("trampa en 0x0556", () => {
  it("carga correcta: memoria, IX/DE, A/F de CP 1, B=B0, C=5E, H=paridad, L=checksum, AF'=bucle", () => {
    insert(tap(tapBlock(0xff, DATA)));
    const r = trap({ a: 0xff, f: 0x01, de: 5, ix: 0x8000 });
    expect(Array.from(core.ram().subarray(0x8000, 0x8006))).toEqual([...DATA, 0]);
    expect(r.ix).toBe(0x8005);
    expect(r.de).toBe(0);
    // 0x05DF LD A,H (paridad 0); CP 1 → A=00, F = S H N C = 0x93.
    expect(r.af).toBe(0x0093);
    expect(r.bc).toBe(0xb05e);     // C = DE tras LD-SYNC, & 7F en LD-FLAG (ver C_AFTER_SYNC)
    expect(r.hl).toBe(0x00fe);     // L = último byte leído = checksum
    expect(r.af_).toBe(0x5e4d);    // AF del bucle tras LD-FLAG: LD A,C ; RRA (Z P 3 C)
    expectFrame();
  });

  it("VERIFY correcto: no escribe y sale igual que la carga", () => {
    insert(tap(tapBlock(0xff, DATA)));
    for (let i = 0; i < 5; i++) core.x.zx_poke(0x9000 + i, DATA[i]!);
    core.x.zx_poke(0x9005, 0x99);
    const r = trap({ a: 0xff, f: 0x00, de: 5, ix: 0x9000 });
    expect(Array.from(core.ram().subarray(0x9000, 0x9006))).toEqual([...DATA, 0x99]);
    expect(r.af).toBe(0x0093);
    expect(r.bc).toBe(0xb05e);
    expect(r.af_).toBe(0x0044);    // AF del bucle tras LD-VERIFY: XOR L = 0
    expect(r.de).toBe(0);
    expect(r.ix).toBe(0x9005);
  });

  it("VERIFY con diferencia en el tercer byte: NC, IX/DE avanzan 2", () => {
    insert(tap(tapBlock(0xff, DATA)));
    for (let i = 0; i < 5; i++) core.x.zx_poke(0x9000 + i, DATA[i]!);
    core.x.zx_poke(0x9002, 0x33);
    const r = trap({ a: 0xff, f: 0x00, de: 5, ix: 0x9000, bc: 0x1122 });
    expect(core.ram()[0x9002]).toBe(0x33);
    expect(r.ix).toBe(0x9002);
    expect(r.de).toBe(3);
    // A = 0 (flag correcto, XOR), F de XOR 0 = Z P = 0x44, sin carry.
    expect(r.af).toBe(0x3024);     // RET NZ de LD-VERIFY: A = 03 ^ 33, flags de XOR (5 P)
    expect(r.bc).toBe(0xb05e);
    expect(r.hl).toBe(0xff03);     // H = FF^1^2^3, L = byte de cinta que no coincide
    expect(r.af_).toBe(0x0304);    // AF principal: LD A,D ; OR E con DE = 3
  });

  it("flag distinto: falla como la ROM (A = diferencia) y consume el bloque", () => {
    insert(tap(tapBlock(0xff, DATA), tapBlock(0x00, header(0, "prog", 10, 10, 10))));
    const r = trap({ a: 0x00, f: 0x01, de: 17, ix: 0x8000, bc: 0x1122 });
    // A = 00 ^ FF; F de XOR FF = S 5 3 P = 0xAC, sin carry.
    expect(r.af).toBe(0xffac);
    expect(r.bc).toBe(0xb0bd);     // RL C en LD-FLAG: DE << 1 | carry de cargar
    expect(r.hl).toBe(0xffff);     // H = paridad = flag, L = flag
    expect(r.de).toBe(17);
    expect(r.ix).toBe(0x8000);
    expect(r.af_).toBe(0x1104);    // AF principal: LD A,D ; OR E con DE = 17
    expect(core.ram()[0x8000]).toBe(0);
    expectFrame();
    // La siguiente llamada lee la cabecera.
    const r2 = trap({ a: 0x00, f: 0x01, de: 17, ix: 0x8000 });
    expect(r2.af & 1).toBe(1);
    expect(Array.from(core.ram().subarray(0x8000, 0x8005))).toEqual([0, ..."prog".split("").map((c) => c.charCodeAt(0))]);
  });

  it("bloque más largo que DE: se leen DE bytes y el siguiente hace de paridad", () => {
    insert(tap(tapBlock(0xff, DATA)));
    const r = trap({ a: 0xff, f: 0x01, de: 3, ix: 0x8000 });
    expect(Array.from(core.ram().subarray(0x8000, 0x8004))).toEqual([1, 2, 3, 0]);
    // paridad = FF^1^2^3^4 = FB; CP 1 → F = S N = 0x82, sin carry.
    expect(r.af).toBe(0xfb82);
    expect(r.bc).toBe(0xb05e);
    expect(r.hl).toBe(0xfb04);     // L = el byte que hizo de paridad
    expect(r.de).toBe(0);
    expect(r.ix).toBe(0x8003);
  });

  it("bloque más corto que DE: copia también el checksum y falla por falta de flancos", () => {
    insert(tap(tapBlock(0xff, DATA)));
    const r = trap({ a: 0xff, f: 0x01, de: 10, ix: 0x8000 });
    expect(Array.from(core.ram().subarray(0x8000, 0x8007))).toEqual([...DATA, 0xfe, 0]);
    // 0x05EC: L = 1, INC B desde FF → B = 0, F = Z H (de INC) sin carry = 0x50.
    expect(r.af).toBe(0x0050);
    expect(r.bc).toBe(0x005e);
    expect(r.hl).toBe(0x0001);
    expect(r.de).toBe(4);
    expect(r.ix).toBe(0x8006);
  });

  it("checksum incorrecto: datos copiados, NC", () => {
    insert(tap(tapBlock(0xff, DATA, 0x00)));
    const r = trap({ a: 0xff, f: 0x01, de: 5, ix: 0x8000 });
    expect(Array.from(core.ram().subarray(0x8000, 0x8005))).toEqual(DATA);
    // paridad FE; CP 1 → F = S N = 0x82 (FE-1 = FD).
    expect(r.af).toBe(0xfe82);
    expect(r.hl).toBe(0xfe00);
  });

  it("DE = 0 (bug de la ROM): sólo se lee el flag; AF' queda el del preámbulo", () => {
    insert(tap(tapBlock(0xff, DATA)));
    const r = trap({ a: 0xff, f: 0x01, de: 0, ix: 0x8000 });
    // A = paridad = FF, CP 1 → F = S N = 0x82; B = B0; L = H = flag.
    expect(r.af).toBe(0xff82);
    expect(r.bc).toBe(0xb0de);     // no pasa por LD-FLAG: C se queda como tras LD-SYNC
    expect(r.hl).toBe(0xffff);
    // INC D (D=0→1, C intacto) ; EX AF,AF' → AF' = FF 01.
    expect(r.af_).toBe(0xff01);
    expect(core.ram()[0x8000]).toBe(0);
  });

  it("carga en pantalla y en ROM: la ROM no se escribe", () => {
    insert(tap(tapBlock(0xff, [0xaa, 0xbb, 0xcc, 0xdd])));
    const rom = rom48();
    trap({ a: 0xff, f: 0x01, de: 4, ix: 0x3ffe });
    expect(core.ram()[0x3ffe]).toBe(rom[0x3ffe]);
    expect(core.ram()[0x3fff]).toBe(rom[0x3fff]);
    expect(core.ram()[0x4000]).toBe(0xcc);
    expect(core.ram()[0x4001]).toBe(0xdd);
  });

  it("fin de cinta: la trampa no actúa y la ROM sigue (espera señal hasta BREAK)", () => {
    insert(tap(tapBlock(0xff, DATA)));
    trap({ a: 0xff, f: 0x01, de: 5, ix: 0x8000 });
    setEntry({ a: 0xff, f: 0x01, de: 5, ix: 0x8000 });
    core.regs.set8("iff1", 0); // que no entre la INT de principio de frame en este paso
    core.x.zx_step();
    // Se ha ejecutado INC D (o el NOP del stub): un byte, sin tocar la pila.
    expect(core.regs.get16("pc")).toBe(LD_BYTES + 1);
    expect(core.regs.get16("sp")).toBe(SP0);
  });

  it("INT pendiente al entrar (EI; CALL 0x0556 con T < 32): primero la ISR, luego la trampa", (ctx) => {
    if (!cpu) ctx.skip();
    // Hardware: la INT se acepta en el límite de instrucción antes de ejecutar 0x0556
    // (docs §2). La ISR de la ROM (0x0038) incrementa FRAMES (0x5C78) y vuelve con
    // EI; RET a 0x0556, donde la trampa ya puede actuar (EI retrasa la INT siguiente).
    insert(tap(tapBlock(0xff, DATA)));
    const want = trap({ a: 0xff, f: 0x01, de: 5, ix: 0x8000 });
    insert(tap(tapBlock(0xff, DATA)));
    setEntry({ a: 0xff, f: 0x01, de: 5, ix: 0x8000, inIntWindow: true });
    core.regs.set16("iy", 0x5c3a);
    core.regs.set8("im", 1);
    expect(core.x.zx_tstate()).toBeLessThan(32);
    let sawIsr = false;
    for (let i = 0; i < 5000 && core.regs.get16("pc") !== LD_RET; i++) {
      core.x.zx_step();
      if (core.regs.get16("pc") === 0x0038) sawIsr = true;
    }
    expect(sawIsr, "la INT debe aceptarse antes de la trampa").toBe(true);
    expect(core.regs.get16("pc")).toBe(LD_RET);
    expect(word(0x5c78), "FRAMES").toBe(1);
    expect(Array.from(core.ram().subarray(0x8000, 0x8006))).toEqual([...DATA, 0]);
    const r = core.regs.snapshot();
    for (const k of ["af", "bc", "de", "hl", "ix", "af_", "sp", "iff1", "iff2"] as const) expect(r[k], k).toBe(want[k]);
    expectFrame();
  });

  it("sin cinta tampoco actúa; zx_reset rebobina", async () => {
    const saved = core;
    core = new Core(await instantiate("core-probe"));
    core.loadRom(rom48());
    setEntry({ a: 0xff, f: 0x01, de: 5, ix: 0x8000 });
    core.regs.set8("iff1", 0); // que no entre la INT de principio de frame en este paso
    core.x.zx_step();
    expect(core.regs.get16("pc")).toBe(LD_BYTES + 1);
    core = saved;
    insert(tap(tapBlock(0xff, DATA)));
    trap({ a: 0xff, f: 0x01, de: 5, ix: 0x8000 });
    core.x.zx_reset();
    trap({ a: 0xff, f: 0x01, de: 5, ix: 0x8000 });
  });
});

// ---- Con CPU real: la ROM como oráculo ----

/** Programa que replica el preámbulo de LD-BYTES (0x0556-0x056A) y entra en LD-START
 *  (0x056C): zx48.c atrapa en 0x0556 y en LD-BREAK (0x056B), y esta entrada no pasa
 *  por ninguno de los dos (salvo que un LD-EDGE agote el tiempo), así que la ROM lee
 *  los pulsos de la cinta. Al volver deja la pila igual que la trampa: SA/LD-RET
 *  apilado sobre el retorno del llamador. */
function pulseEntryProgram() {
  const code = [
    0x14,             // INC D
    0x08,             // EX AF,AF'
    0x15,             // DEC D
    0xf3,             // DI
    0x3e, 0x0f,       // LD A,0x0F
    0xd3, 0xfe,       // OUT (0xFE),A
    0x21, 0x3f, 0x05, // LD HL,0x053F
    0xe5,             // PUSH HL
    // En vez de IN A,(0xFE): el valor que lee la ROM en 0x0562 cuando la cinta
    // arranca en ese IN (tape.c, primer flanco → EAR = 1, sin teclas): FF. Un IN aquí,
    // fuera de la zona de la ROM, leería EAR = 0 y C acabaría distinto (ver el
    // cargador reubicado más abajo).
    0x3e, 0xff,       // LD A,0xFF
    0x1f,             // RRA
    0xe6, 0x20,       // AND 0x20
    0xf6, 0x02,       // OR 0x02
    0x4f,             // LD C,A
    0xbf,             // CP A
    0xc3, 0x6c, 0x05, // JP 0x056C
  ];
  code.forEach((b, i) => core.x.zx_poke(0x7000 + i, b));
}

function runUntil(pc: number, maxFrames: number): boolean {
  core.x.zx_bp_clear_all();
  core.x.zx_bp_set(pc, 1);
  for (let i = 0; i < maxFrames; i++) {
    if (core.runFrame() === STOP.BREAKPOINT) {
      core.x.zx_bp_clear_all();
      return true;
    }
  }
  core.x.zx_bp_clear_all();
  return false;
}

describe("ROM real (pulsos) frente a la trampa", () => {
  const cases: { name: string; blocks: number[][]; e: Entry; pre?: [number, number][] }[] = [
    { name: "carga correcta", blocks: [tapBlock(0xff, DATA)], e: { a: 0xff, f: 0x01, de: 5, ix: 0x8000 } },
    { name: "cabecera", blocks: [tapBlock(0x00, header(3, "abc", 5, 0x8000, 0x8000))], e: { a: 0x00, f: 0x01, de: 17, ix: 0x8000 } },
    { name: "flag distinto", blocks: [tapBlock(0xff, DATA)], e: { a: 0x00, f: 0x01, de: 5, ix: 0x8000 } },
    { name: "más largo que DE", blocks: [tapBlock(0xff, DATA)], e: { a: 0xff, f: 0x01, de: 3, ix: 0x8000 } },
    { name: "checksum malo", blocks: [tapBlock(0xff, DATA, 0)], e: { a: 0xff, f: 0x01, de: 5, ix: 0x8000 } },
    { name: "más corto que DE", blocks: [tapBlock(0xff, DATA)], e: { a: 0xff, f: 0x01, de: 10, ix: 0x8000 } },
    { name: "DE = 0", blocks: [tapBlock(0xff, DATA)], e: { a: 0xff, f: 0x01, de: 0, ix: 0x8000 } },
    { name: "verify correcto", blocks: [tapBlock(0xff, DATA)], e: { a: 0xff, f: 0x00, de: 5, ix: 0x9000 },
      pre: [[0x9000, 1], [0x9001, 2], [0x9002, 3], [0x9003, 4], [0x9004, 5]] },
    { name: "verify con flag distinto", blocks: [tapBlock(0x00, DATA)], e: { a: 0xff, f: 0x00, de: 5, ix: 0x9000 } },
    { name: "verify con diferencia", blocks: [tapBlock(0xff, DATA)], e: { a: 0xff, f: 0x00, de: 5, ix: 0x9000 },
      pre: [[0x9000, 1], [0x9001, 2], [0x9002, 0x33]] },
  ];

  for (const c of cases) {
    it(c.name, (ctx) => {
      if (!cpu) ctx.skip();
      const t = tap(...c.blocks);
      const prep = () => { insert(t); for (const [a, v] of c.pre ?? []) core.x.zx_poke(a, v); };

      // Trampa: un paso (0x0556 → 0x05E2) y el RET a SA/LD-RET.
      prep();
      setEntry(c.e);
      core.x.zx_step();
      expect(core.regs.get16("pc")).toBe(LD_RET);
      core.x.zx_step();
      expect(core.regs.get16("pc")).toBe(SA_LD_RET);
      const rt = core.regs.snapshot();
      const mt = core.ram().slice(0x4000);

      // ROM leyendo pulsos.
      prep();
      pulseEntryProgram();
      setEntry(c.e);
      core.x.zx_set_pc(0x7000);
      const f0 = core.x.zx_frame_count();
      expect(runUntil(SA_LD_RET, 3000), "la ROM debe volver a SA/LD-RET").toBe(true);
      // Más de un segundo: la ROM ha leído pulsos (LD-WAIT ya espera 1 s), no la trampa.
      expect(core.x.zx_frame_count() - f0).toBeGreaterThan(50);
      const rr = core.regs.snapshot();
      const mr = core.ram().slice(0x4000);

      // RAM de 0x8000 a 0xFEF0: fuera del programa de 0x7000 y de la pila que usa la ROM.
      expect(mr.subarray(0x4000, 0xbef0)).toEqual(mt.subarray(0x4000, 0xbef0));
      const hex = (v: number) => v.toString(16).padStart(4, "0");
      const diff = (["af", "bc", "de", "hl", "ix", "af_", "sp"] as const)
        .filter((k) => rt[k] !== rr[k]).map((k) => `${k}: trampa ${hex(rt[k])} ROM ${hex(rr[k])}`);
      // La trampa debe dejar exactamente lo que deja la ROM (salvo R y T-states).
      expect(diff, diff.join(", ")).toEqual([]);
      expect(rt.iff1).toBe(rr.iff1);
    });
  }
});

describe("trampa en LD-BREAK (0x056B): cargadores que entran por 0x0562", () => {
  it("con el preámbulo propio y JP 0x0562 la carga es instantánea y deja el estado de la ROM", (ctx) => {
    if (!cpu) ctx.skip();
    // Fuse atrapa en 0x056B (tape_traps.c), con el preámbulo de LD-BYTES ya hecho. El
    // estado esperado es el de la trampa en 0x0556, que la ROM real fija arriba.
    const t = tap(tapBlock(0xff, DATA), tapBlock(0xff, [9, 8, 7]));
    const e: Entry = { a: 0xff, f: 0x01, de: 5, ix: 0x8000 };
    insert(t);
    setEntry(e);
    core.x.zx_step();
    core.x.zx_step();
    const rt = core.regs.snapshot();

    insert(t);
    const code = [0x14, 0x08, 0x15, 0xf3, 0x3e, 0x0f, 0xd3, 0xfe, 0x21, 0x3f, 0x05, 0xe5, 0xc3, 0x62, 0x05];
    code.forEach((b, i) => core.x.zx_poke(0x7000 + i, b));
    setEntry(e);
    core.x.zx_set_pc(0x7000);
    let steps = 0;
    while (core.regs.get16("pc") !== SA_LD_RET && steps < 100) { core.x.zx_step(); steps++; }
    expect(core.regs.get16("pc"), "debe volver a SA/LD-RET en pocos pasos (sin leer pulsos)").toBe(SA_LD_RET);
    expect(Array.from(core.ram().subarray(0x8000, 0x8006))).toEqual([...DATA, 0]);
    const rr = core.regs.snapshot();
    for (const k of ["af", "bc", "de", "hl", "ix", "af_", "sp", "iff1"] as const) expect(rr[k], k).toBe(rt[k]);
    // El bloque siguiente sigue en su sitio.
    const r2 = trap({ a: 0xff, f: 0x01, de: 3, ix: 0x9000 });
    expect(r2.af & 1).toBe(1);
    expect(Array.from(core.ram().subarray(0x9000, 0x9003))).toEqual([9, 8, 7]);
  });

  it("en 0x056B con Z = 0 (BREAK) no atrapa", () => {
    insert(tap(tapBlock(0xff, DATA)));
    setEntry({ a: 0xff, f: 0x00, de: 5, ix: 0x8000 });
    core.x.zx_set_pc(0x056b);
    setTstate(1000);
    core.x.zx_step();
    // RET NZ tomado: vuelve al llamador apilado.
    expect(core.regs.get16("pc")).toBe(CALLER);
  });
});

// ---- Cargador propio: arranque automático de la cinta fuera de la ROM ----

describe("cargador propio en RAM (pulsos con arranque automático)", () => {
  /** Copia LD-BYTES (0x0556-0x0604) a 0xA556 reubicando sus CALL/JP absolutos: es un
   *  cargador que no pasa por la trampa ni por la zona de la ROM. */
  function relocatedLdBytes() {
    const rom = rom48();
    const code = Array.from(rom.subarray(0x0556, 0x0605));
    for (const at of [0x056c, 0x057b, 0x0582, 0x0591, 0x059b, 0x05ca, 0x05d5, 0x05e3]) {
      const i = at - 0x0556;
      expect([0xcd, 0xd2]).toContain(code[i]);
      const target = code[i + 1]! | (code[i + 2]! << 8);
      expect(target >= 0x0556 && target < 0x0605).toBe(true);
      code[i + 2]! += 0xa0;
    }
    code.forEach((b, i) => core.x.zx_poke(0xa556 + i, b));
  }

  it("carga un bloque igual que la trampa", (ctx) => {
    if (!cpu) ctx.skip();
    const t = tap(tapBlock(0xff, DATA), tapBlock(0xff, [9, 8, 7]));
    const e: Entry = { a: 0xff, f: 0x01, de: 5, ix: 0x8000 };

    insert(t);
    setEntry(e);
    core.x.zx_step();
    core.x.zx_step();
    expect(core.regs.get16("pc")).toBe(SA_LD_RET);
    const rt = core.regs.snapshot();

    insert(t);
    relocatedLdBytes();
    setEntry(e);
    core.x.zx_set_pc(0xa556);
    expect(runUntil(SA_LD_RET, 3000), "el cargador propio debe volver a SA/LD-RET").toBe(true);
    const rr = core.regs.snapshot();
    expect(Array.from(core.ram().subarray(0x8000, 0x8006))).toEqual([...DATA, 0]);
    for (const k of ["af", "de", "hl", "ix", "sp"] as const) expect(rr[k], k).toBe(rt[k]);
    expect(rr.bc >> 8).toBe(rt.bc >> 8);
    // C sí cambia: su bit 5 sigue al nivel EAR desde el primer IN (C0 = 02 | EAR << 5),
    // y aquí la cinta arranca después de ese IN (EAR = 0, Issue 3) y no en él, como en
    // la zona de la ROM. Con nivel 0 al empezar los datos: C = C0 ^ 3 = 01 (& 7F en LD-FLAG).
    expect(rr.bc & 0xff).toBe(0x01);
    // A' es la copia de C que guarda LD-DEC (EX AF,AF' tras LD A,C; RRA; LD C,A), y F'
    // los flags de ese RRA: bits 3/5 copiados de A, el resto igual que con la trampa.
    expect(rr.af_ >> 8).toBe(rr.bc & 0xff);
    expect(rt.af_ >> 8).toBe(rt.bc & 0xff);
    expect(rr.af_ & 0xd7).toBe(rt.af_ & 0xd7);
    expect(rr.af_ & 0x28).toBe((rr.af_ >> 8) & 0x28);

    // La cinta se para sola al acabar la pausa del bloque; el siguiente sigue
    // disponible para la trampa.
    runFrames(core, 100);
    const r2 = trap({ a: 0xff, f: 0x01, de: 3, ix: 0x9000 });
    expect(r2.af & 1).toBe(1);
    expect(Array.from(core.ram().subarray(0x9000, 0x9003))).toEqual([9, 8, 7]);
  });

  it("falso positivo: un bucle con DI que lee el teclado no se come la cinta", (ctx) => {
    if (!cpu) ctx.skip();
    // Menú típico: DI y espera de tecla en un bucle cerrado de 41 T. La cinta no debe
    // avanzar (y si arranca a prueba, el programa no reacciona a los flancos y se
    // rebobina); después LD-BYTES carga el PRIMER bloque.
    insert(tap(tapBlock(0xff, DATA), tapBlock(0xff, [9, 8, 7])));
    // 8000 DI ; 8001 XOR A ; IN A,(FE) ; AND 1F ; CP 1F ; JR Z,8001
    [0xf3, 0xaf, 0xdb, 0xfe, 0xe6, 0x1f, 0xfe, 0x1f, 0x28, 0xf7].forEach((b, i) => core.x.zx_poke(0x8000 + i, b));
    core.x.zx_set_pc(0x8000);
    runFrames(core, 250);          // 5 s: más que guía + datos + pausa del primer bloque
    expect(core.regs.get16("pc")).toBeGreaterThanOrEqual(0x8001);
    expect(core.regs.get16("pc")).toBeLessThan(0x800a);
    const r = trap({ a: 0xff, f: 0x01, de: 5, ix: 0x9000 });
    expect(r.af & 1).toBe(1);
    expect(Array.from(core.ram().subarray(0x9000, 0x9005))).toEqual(DATA);
  });

  it("cargador propio que abandona un bloque a medias: LD-BYTES lo carga desde el principio", (ctx) => {
    if (!cpu) ctx.skip();
    const big = Array.from({ length: 200 }, (_, i) => (i % 250) + 1);
    insert(tap(tapBlock(0xff, big), tapBlock(0xff, [9, 8, 7])));
    relocatedLdBytes();
    setEntry({ a: 0xff, f: 0x01, de: 200, ix: 0x8000 });
    core.x.zx_set_pc(0xa556);
    let frames = 0;
    while (core.ram()[0x8010] !== big[0x10] && frames < 1000) { core.runFrame(); frames++; }
    expect(core.ram()[0x8010], "el cargador propio debe ir por la mitad").toBe(big[0x10]);
    expect(core.ram()[0x80c7]).toBe(0);
    // El programa abandona el cargador y llama a LD-BYTES: la trampa rebobina.
    const r = trap({ a: 0xff, f: 0x01, de: 200, ix: 0x9000 });
    expect(r.af & 1).toBe(1);
    expect(Array.from(core.ram().subarray(0x9000, 0x9000 + 200))).toEqual(big);
    const r2 = trap({ a: 0xff, f: 0x01, de: 3, ix: 0xa000 });
    expect(r2.af & 1).toBe(1);
    expect(Array.from(core.ram().subarray(0xa000, 0xa003))).toEqual([9, 8, 7]);
  });
});
