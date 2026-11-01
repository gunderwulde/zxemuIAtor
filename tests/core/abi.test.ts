// Fase 0.5/0.6: los tres .wasm se instancian, exportan la ABI completa y el layout de
// registros coincide entre C (zx.h) y TS (regs.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { Core, CORE_EXPORTS, FB_HEIGHT, FB_WIDTH, STOP, TSTATES_PER_FRAME } from "../../web/src/emu/core";
import { REG, RegsView } from "../../web/src/emu/regs";
import { instantiate, rom48 } from "../util/wasm";

const PROBE_EXPORTS = [
  "zx_t_set_tstate", "zx_t_contention", "zx_t_run_until", "zx_t_set_int_enabled",
  "zx_t_buslog_enable", "zx_t_buslog", "zx_t_buslog_len", "zx_t_beeper_log", "zx_t_beeper_log_len",
];
const TESTBUS_EXPORTS = [
  "memory", "tb_reset", "tb_mem", "tb_regs", "tb_tstates", "tb_set_tstates", "tb_step", "tb_run", "tb_run_to",
  "tb_set_int", "tb_set_int_data", "tb_nmi", "tb_log_enable", "tb_events", "tb_event_count",
  "tb_port_queue", "tb_port_queue_set",
];

describe("exports", () => {
  it("core.wasm exporta la ABI de zx.h y nada de test", async () => {
    const x = (await instantiate("core")).exports;
    for (const name of CORE_EXPORTS) expect(x, name).toHaveProperty(name);
    for (const name of PROBE_EXPORTS) expect(x, name).not.toHaveProperty(name);
  });

  it("core-probe.wasm añade los hooks de test", async () => {
    const x = (await instantiate("core-probe")).exports;
    for (const name of [...CORE_EXPORTS, ...PROBE_EXPORTS]) expect(x, name).toHaveProperty(name);
  });

  it("core-test.wasm exporta la ABI de testbus.h", async () => {
    const x = (await instantiate("core-test")).exports;
    for (const name of TESTBUS_EXPORTS) expect(x, name).toHaveProperty(name);
  });
});

describe("core", () => {
  let core: Core;
  beforeAll(async () => {
    core = new Core(await instantiate("core"));
  });

  it("rechaza una ROM de tamaño incorrecto", () => {
    expect(() => core.loadRom(new Uint8Array(100))).toThrow();
  });

  it("carga la ROM en 0x0000 y la protege contra escritura", () => {
    const rom = rom48();
    core.loadRom(rom);
    expect(core.ram().subarray(0, 16384)).toEqual(rom);
    core.x.zx_poke(0x0000, 0x12);
    expect(core.ram()[0]).toBe(rom[0]);
    core.x.zx_poke(0x8000, 0x12);
    expect(core.ram()[0x8000]).toBe(0x12);
  });

  it("registros de encendido visibles en los offsets de regs.ts", () => {
    core.x.zx_reset();
    const r = core.regs.snapshot();
    expect(r.af).toBe(0xffff);
    expect(r.sp).toBe(0xffff);
    expect(r.pc).toBe(0);
    core.x.zx_set_pc(0x1234);
    expect(core.regs.get16("pc")).toBe(0x1234);
    expect(core.mem[core.x.zx_regs() + REG.pc]).toBe(0x34);
    expect(core.mem[core.x.zx_regs() + REG.pc + 1]).toBe(0x12);
  });

  it("zx_run_frame completa frames de 69888 T", () => {
    core.x.zx_reset();
    for (let i = 0; i < 3; i++) expect(core.runFrame()).toBe(STOP.FRAME);
    expect(core.x.zx_frame_count()).toBe(3);
    expect(core.x.zx_tstate()).toBeLessThan(32);
  });

  it("framebuffer RGBA opaco de 352×296", () => {
    const fb = core.framebuffer();
    expect(fb.length).toBe(FB_WIDTH * FB_HEIGHT * 4);
    for (let i = 3; i < fb.length; i += 4) if (fb[i] !== 255) throw new Error(`alpha en ${i}`);
  });

  it("para en un breakpoint sin ejecutarlo y continúa al reanudar", () => {
    core.x.zx_reset();
    core.x.zx_bp_set(0x0005, 1);
    expect(core.runFrame()).toBe(STOP.BREAKPOINT);
    expect(core.regs.get16("pc")).toBe(0x0005);
    expect(core.runFrame()).toBe(STOP.FRAME);
    expect(core.regs.get16("pc")).not.toBe(0x0005);
    core.x.zx_bp_clear_all();
  });

  it("audio: nº de muestras exacto a lo largo de muchos frames (resto arrastrado)", () => {
    core.x.zx_reset();
    let total = 0;
    for (let i = 0; i < 50; i++) {
      core.runFrame();
      total += core.audio(48000).length;
    }
    expect(total).toBe(Math.floor((50 * TSTATES_PER_FRAME * 48000) / 3_500_000));
  });
});

describe("testbus", () => {
  it("registra eventos en el formato de FUSE y comparte el layout de registros", async () => {
    const inst = await instantiate("core-test");
    const x = inst.exports as unknown as Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory };
    x.tb_reset!();
    x.tb_log_enable!(1);
    x.tb_step!();
    const ev = new DataView(x.memory.buffer, x.tb_events!(), x.tb_event_count!() * 8);
    const events = [];
    for (let i = 0; i < x.tb_event_count!(); i++) {
      events.push({ t: ev.getUint32(i * 8, true), addr: ev.getUint16(i * 8 + 4, true), kind: ev.getUint8(i * 8 + 6) });
    }
    // NOP en 0x0000: "0 MC 0000", "4 MR 0000 00"
    expect(events).toEqual([{ t: 0, addr: 0, kind: 0 }, { t: 4, addr: 0, kind: 1 }]);
    const regs = new RegsView(x.memory, x.tb_regs!());
    expect(regs.get16("pc")).toBe(1);
    expect(regs.get8("r")).toBe(1);
  });
});
