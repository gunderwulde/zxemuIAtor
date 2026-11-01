// D1: semántica de breakpoints del núcleo (core.wasm) en dos casos de borde que señaló
// la revisión de fase 1. Oráculos: core/include/zx.h (ZX_STOP_BREAKPOINT para ANTES de
// ejecutar la instrucción en el PC) y docs/zx48-hardware.md (HALT repite M1 de 4 T con el
// PC en el HALT hasta la INT del frame siguiente). Los arreglos van en zx48.c y snap.c
// (no son de D1); ver informe de D1.
import { beforeEach, describe, expect, it } from "vitest";
import { assemble } from "../../web/src/asm";
import { Core, STOP } from "../../web/src/emu/core";
import { Loop } from "../../web/src/emu/loop";
import { Debugger } from "../../web/src/ui/debugger/controller";
import { instantiate, rom48 } from "../util/wasm";

let core: Core;

function load(src: string): void {
  const r = assemble(src);
  expect(r.errors).toEqual([]);
  for (const s of r.segments) s.bytes.forEach((b, i) => core.x.zx_poke(s.addr + i, b));
}

beforeEach(async () => {
  core = new Core(await instantiate("core"));
  core.loadRom(rom48());
  for (let i = 0; i < 120; i++) core.runFrame(); // ROM arrancada: IM 1, IY = 5C3Ah
});

describe("breakpoints del núcleo: casos de borde", () => {
  it("continuar desde un breakpoint en HALT corre hasta la INT (no para en cada M1)", async () => {
    load(`
        org 8000h
top:    ei              ; 8000
        halt            ; 8001
        inc b           ; 8002
        jr top          ; 8003
    `);
    core.x.zx_set_pc(0x8000);
    let now = 0;
    const loop = new Loop(core, { now: () => now, raf: () => {} });
    loop.start();
    loop.setPaused(true);
    const dbg = new Debugger(core, loop);
    dbg.toggleBp(0x8001);
    const tick = async () => { now += 20; loop.tick(now); await Promise.resolve(); await Promise.resolve(); };

    dbg.resume();
    for (let i = 0; i < 5 && !loop.isPaused; i++) await tick();
    expect(dbg.pc).toBe(0x8001);
    expect(core.regs.get8("halted")).toBe(0); // paró antes de ejecutar el HALT

    const b = core.regs.get16("bc") >> 8, f = core.x.zx_frame_count();
    dbg.resume(); // ejecuta HALT; la máquina debe esperar la INT sin volver a parar
    for (let i = 0; i < 5 && !loop.isPaused; i++) await tick();
    expect(loop.isPaused).toBe(true);
    expect(dbg.pc).toBe(0x8001);
    expect(core.regs.get8("halted")).toBe(0);
    expect(core.regs.get16("bc") >> 8).toBe((b + 1) & 0xff);  // una vuelta: INC B
    expect(core.x.zx_frame_count()).toBeGreaterThan(f);       // pasó por la INT
  });

  it("cargar un SNA cuyo PC tiene breakpoint para en él aunque acabáramos de parar en uno", () => {
    load(`
        org 8000h
        di
spin:   inc b           ; 8001
        jr spin
    `);
    core.x.zx_set_pc(0x8000);
    core.x.zx_bp_set(0x8001, 1);
    let stop = STOP.FRAME as number;
    for (let i = 0; i < 3 && stop !== STOP.BREAKPOINT; i++) stop = core.runFrame();
    expect(stop).toBe(STOP.BREAKPOINT);
    expect(core.regs.get16("pc")).toBe(0x8001);
    const b = core.regs.get16("bc") >> 8;
    const sna = core.saveSna();                 // estado con PC = 8001h
    expect(core.loadSna(sna)).toBe(0);
    expect(core.regs.get16("pc")).toBe(0x8001);
    // Debe parar sin ejecutar nada (si se saltase el breakpoint, INC B correría una vez
    // y volvería a parar en la misma dirección).
    expect(core.runFrame()).toBe(STOP.BREAKPOINT);
    expect(core.regs.get16("pc")).toBe(0x8001);
    expect(core.regs.get16("bc") >> 8).toBe(b);
  });
});
