// D1: lógica del depurador (sin DOM) contra el núcleo real (core.wasm + ROM 48K) y el
// bucle real (emu/loop.ts) con un reloj falso. Los valores esperados salen del programa
// de prueba escrito a mano (direcciones contadas sobre su fuente) y de la semántica de
// parada documentada en core/include/zx.h (el breakpoint para ANTES de ejecutar).
import { beforeEach, describe, expect, it } from "vitest";
import { assemble } from "../../web/src/asm";
import { Core } from "../../web/src/emu/core";
import { Loop } from "../../web/src/emu/loop";
import { Debugger } from "../../web/src/ui/debugger/controller";
import { instantiate, rom48 } from "../util/wasm";

// Direcciones a mano (bytes por instrucción entre paréntesis):
const SRC = `
        org 8000h
start:  di              ; 8000 (1)
        ld a,1          ; 8001 (2)
        call sub        ; 8003 (3)
        ld e,a          ; 8006 (1)
spin:   inc b           ; 8007 (1)
        jr spin         ; 8008 (2)
sub:    ld c,5          ; 800A (2)
        ld a,c          ; 800C (1)
        ret             ; 800D (1)
main2:  ld d,3          ; 800E (2)
        call rec        ; 8010 (3)
        jr spin         ; 8013 (2)
rec:    dec d           ; 8015 (1)
        jr z,done       ; 8016 (2)
rcall:  call rec        ; 8018 (3)
back:   nop             ; 801B (1)
done:   ret             ; 801C (1)
pfx:    db 0DDh         ; 801D (1) prefijo DD sin efecto
        call sub        ; 801E (3)
        jr spin         ; 8021 (2)
copy:   ld hl,4000h     ; 8023 (3)
        ld de,4001h     ; 8026 (3)
        ld bc,10        ; 8029 (3)
        ldir            ; 802C (2)
        jr spin         ; 802E (2)
`;
const A = {
  start: 0x8000, call: 0x8003, ldEA: 0x8006, spin: 0x8007, sub: 0x800a,
  main2: 0x800e, rcall: 0x8018, back: 0x801b, pfx: 0x801d, afterPfx: 0x8021,
  copy: 0x8023, ldir: 0x802c, afterLdir: 0x802e,
};

let core: Core;
let loop: Loop;
let dbg: Debugger;
let now = 0;

/** Ticks del bucle (1 frame cada uno) hasta que se pause, como mucho `max`. */
async function runUntilPaused(max = 50): Promise<number> {
  for (let i = 0; i < max; i++) {
    if (loop.isPaused) break;
    now += 20;
    loop.tick(now);
    await Promise.resolve(); // microtareas del depurador (paused → breakpoint)
  }
  await Promise.resolve();
  return core.regs.get16("pc");
}

const reg = (r: "bc" | "de" | "hl" | "af" | "sp") => core.regs.get16(r);

beforeEach(async () => {
  core = new Core(await instantiate("core"));
  core.loadRom(rom48());
  for (let i = 0; i < 120; i++) core.runFrame(); // la ROM deja una pila válida
  const r = assemble(SRC);
  expect(r.errors).toEqual([]);
  for (const s of r.segments) s.bytes.forEach((b, i) => core.x.zx_poke(s.addr + i, b));
  core.x.zx_set_pc(A.start);
  // Sin INT: al acabar un frame la línea INT está activa y el primer paso la aceptaría
  // (docs §1); el DI del programa lo mantiene así.
  core.regs.set8("iff1", 0);
  core.regs.set8("iff2", 0);
  now = 0;
  loop = new Loop(core, { now: () => now, raf: () => {} });
  loop.start();
  loop.setPaused(true);
  dbg = new Debugger(core, loop);
  dbg.setProgram(r.lineMap);
});

describe("depurador contra el núcleo real", () => {
  it("paso a paso: una instrucción por zx_step", () => {
    dbg.step();
    expect(dbg.pc).toBe(0x8001);
    dbg.step();
    expect(dbg.pc).toBe(A.call);
    expect(reg("af") >> 8).toBe(1);
    dbg.step(); // entra en el CALL
    expect(dbg.pc).toBe(A.sub);
  });

  it("paso por encima de un CALL para en la instrucción siguiente y limpia el temporal", async () => {
    dbg.step(); dbg.step();
    expect(dbg.pc).toBe(A.call);
    const sp = reg("sp");
    dbg.stepOver();
    expect(loop.isPaused).toBe(false);
    expect(dbg.tempAddr).toBe(A.ldEA);
    expect(await runUntilPaused()).toBe(A.ldEA);
    expect(reg("bc") & 0xff).toBe(5);        // C = 5: la subrutina se ejecutó
    expect(reg("sp")).toBe(sp);
    expect(dbg.tempAddr).toBeNull();
    // El temporal ya no está en el mapa del núcleo: seguir corriendo no para.
    dbg.resume();
    await runUntilPaused(5);
    expect(loop.isPaused).toBe(false);
  });

  it("paso por encima de algo que no es CALL es un paso", () => {
    dbg.stepOver();
    expect(dbg.pc).toBe(0x8001);
    expect(loop.isPaused).toBe(true);
    expect(dbg.tempAddr).toBeNull();
  });

  it("breakpoint: para en la dirección sin ejecutarla y se puede continuar desde él", async () => {
    dbg.toggleBp(A.spin);
    dbg.resume();
    expect(await runUntilPaused()).toBe(A.spin);
    const b0 = reg("bc") >> 8;
    expect(reg("de") & 0xff).toBe(5);         // LD E,A ya se ejecutó (A = C = 5)
    dbg.resume();                              // ejecuta INC B, JR y vuelve a parar
    expect(await runUntilPaused()).toBe(A.spin);
    expect(reg("bc") >> 8).toBe((b0 + 1) & 0xff);
    dbg.resume();
    expect(await runUntilPaused()).toBe(A.spin);
    expect(reg("bc") >> 8).toBe((b0 + 2) & 0xff);
    // Quitado, ya no para.
    expect(dbg.toggleBp(A.spin)).toBe(false);
    dbg.resume();
    await runUntilPaused(5);
    expect(loop.isPaused).toBe(false);
  });

  it("paso por encima con recursión: sigue hasta volver con la misma pila", async () => {
    core.x.zx_set_pc(A.main2);
    dbg.runTo(A.rcall);                        // primera llegada (D = 2)
    expect(await runUntilPaused()).toBe(A.rcall);
    expect(reg("de") >> 8).toBe(2);
    const sp = reg("sp");
    dbg.stepOver();
    // Por el camino se pasa por 801Bh con la pila más profunda: no debe parar ahí.
    expect(await runUntilPaused()).toBe(A.back);
    expect(reg("sp")).toBe(sp);
    expect(reg("de") >> 8).toBe(0);
    expect(dbg.tempAddr).toBeNull();
  });

  it("paso por encima de DD + CALL (prefijo sin efecto) salta toda la instrucción", async () => {
    core.x.zx_set_pc(A.pfx);
    dbg.stepOver();
    expect(await runUntilPaused()).toBe(A.afterPfx);
    expect(reg("bc") & 0xff).toBe(5);
  });

  it("paso por encima de LDIR completa el bloque", async () => {
    core.x.zx_set_pc(A.copy);
    dbg.step(); dbg.step(); dbg.step();
    expect(dbg.pc).toBe(A.ldir);
    dbg.stepOver();
    expect(await runUntilPaused()).toBe(A.afterLdir);
    expect(reg("bc")).toBe(0);
    expect(reg("hl")).toBe(0x400a);
  });

  it("hasta el cursor (por línea del fuente) y temporal que se limpia", async () => {
    const line = SRC.split("\n").findIndex((l) => l.startsWith("spin:")) + 1;
    expect(dbg.addrOfLine(line)).toBe(A.spin);
    expect(dbg.lineOf(A.spin)).toBe(line);
    expect(dbg.lineOf(A.spin + 1)).toBe(line + 1); // jr spin
    expect(dbg.lineOf(0x9000)).toBeNull();
    dbg.runTo(dbg.addrOfLine(line)!);
    expect(await runUntilPaused()).toBe(A.spin);
    expect(dbg.tempAddr).toBeNull();
    dbg.resume();
    await runUntilPaused(5);
    expect(loop.isPaused).toBe(false);
  });

  it("una pausa manual cancela el paso por encima pendiente", async () => {
    core.x.zx_set_pc(A.main2);
    dbg.runTo(0x7000); // nunca se alcanza
    await runUntilPaused(3);
    expect(dbg.tempAddr).toBe(0x7000);
    loop.setPaused(true);
    await Promise.resolve();
    expect(dbg.tempAddr).toBeNull();
  });

  it("breakpoints de fuente y de dirección se combinan en el mapa del núcleo", async () => {
    dbg.setSourceBps([A.spin]);
    dbg.toggleBp(A.spin);
    dbg.toggleBp(A.spin);                      // quitar el de dirección deja el de fuente
    expect(dbg.hasBp(A.spin)).toBe(true);
    dbg.resume();
    expect(await runUntilPaused()).toBe(A.spin);
    dbg.setSourceBps([]);
    dbg.resume();
    await runUntilPaused(5);
    expect(loop.isPaused).toBe(false);
  });

  it("poke y tiempo", () => {
    dbg.poke(0x9000, 0x1ab);
    expect(core.ram()[0x9000]).toBe(0xab);
    dbg.poke(0x0000, 0x00);                    // ROM: se ignora
    expect(core.ram()[0]).toBe(0xf3);          // DI, primer byte de la ROM 48K
    const t = dbg.time();
    expect(t.line).toBe(Math.floor(t.t / 224));
    expect(t.col).toBe(t.t % 224);
    expect(t.frame).toBe(core.x.zx_frame_count());
  });
});
