// ULA-40 sobre la máquina real (core.wasm / core-probe.wasm): integración de audio.c
// con zx48.c. Las pruebas que necesitan que la CPU ejecute OUT se saltan solas mientras
// z80.c sea el stub de fase 0 (se detecta ejecutando LD A,n).
import { beforeAll, describe, expect, it } from "vitest";
import { Core, CPU_HZ, STOP, TSTATES_PER_FRAME } from "../../../web/src/emu/core";
import { instantiate } from "../../util/wasm";
import { zeroCrossFreq } from "./ref";

// Bucle de onda cuadrada en RAM no contendida (0x8000), con DI:
//   8000 DI / 8001 LD A,10h / OUT (FEh),A / LD B,50 / DJNZ $ / XOR A / OUT (FEh),A /
//   LD B,50 / DJNZ $ / JP 8001h
const PROGRAM = [
  0xf3, 0x3e, 0x10, 0xd3, 0xfe, 0x06, 50, 0x10, 0xfe,
  0xaf, 0xd3, 0xfe, 0x06, 50, 0x10, 0xfe, 0xc3, 0x01, 0x80,
];

interface Probe {
  zx_t_run_until(t: number): number;
  zx_t_beeper_log(): number;
  zx_t_beeper_log_len(): number;
}

function setup(core: Core): void {
  core.x.zx_reset();
  core.ram().set(PROGRAM, 0x8000);
  core.x.zx_set_pc(0x8000);
}

function cpuIsReal(core: Core): boolean {
  setup(core);
  core.x.zx_step();   // DI
  core.x.zx_step();   // LD A,10h
  return core.regs.get16("af") >> 8 === 0x10;
}

describe("ULA-40 beeper en la máquina", () => {
  let core: Core, probe: Core, realCpu: boolean;
  beforeAll(async () => {
    core = new Core(await instantiate("core"));
    probe = new Core(await instantiate("core-probe"));
    realCpu = cpuIsReal(probe);
    if (!realCpu) console.warn("z80.c es todavía el stub: se saltan las pruebas con OUT reales");
  });

  it("core.wasm: nº exacto de muestras en 500 frames a 44,1/48/96 kHz y silencio exacto sin OUT", () => {
    for (const rate of [44100, 48000, 96000]) {
      core.x.zx_reset();
      let total = 0, nonZero = 0;
      for (let f = 0; f < 500; f++) {
        core.runFrame();
        const s = core.audio(rate);
        total += s.length;
        for (const v of s) if (v !== 0) nonZero++;
      }
      expect(total, `rate ${rate}`).toBe(Math.floor((500 * TSTATES_PER_FRAME * rate) / CPU_HZ));
      expect(nonZero).toBe(0);
    }
  });

  it("sin frame cerrado (parada en breakpoint) zx_audio_render devuelve 0", () => {
    setup(core);
    core.x.zx_bp_set(0x8005, 1);
    expect(core.runFrame()).toBe(STOP.BREAKPOINT);
    expect(core.audio(48000).length).toBe(0);
    core.x.zx_bp_clear_all();
  });

  it("core-probe: el log registra los OUT del bucle y la salida suena a 3,5e6/periodo ±0,5 %", (ctx) => {
    if (!realCpu) ctx.skip();
    const p = probe.x as unknown as Probe;
    setup(probe);
    const rate = 48000;
    const out: number[] = [];
    let rises: number[] = [];
    for (let f = 0; f < 50; f++) {
      p.zx_t_run_until(TSTATES_PER_FRAME - 200);
      if (f === 1) {
        const log = new Uint32Array(probe.x.memory.buffer, p.zx_t_beeper_log(), 2 * p.zx_t_beeper_log_len());
        for (let i = 0; i < log.length; i += 2) if (log[i + 1] === 2) rises.push(log[i]!);
        // Sólo cambios: alterna EAR=1 (código 2) y EAR=0 (código 0), t creciente.
        for (let i = 2; i < log.length; i += 2) {
          expect(log[i]!).toBeGreaterThan(log[i - 2]!);
          expect(log[i + 1]).not.toBe(log[i - 1]);
        }
      }
      probe.runFrame();
      out.push(...probe.audio(rate));
    }
    expect(rises.length).toBeGreaterThan(20);
    const period = (rises[rises.length - 1]! - rises[0]!) / (rises.length - 1);
    const want = CPU_HZ / period;
    const got = zeroCrossFreq(out, rate, rate / 10);
    expect(Math.abs(got / want - 1), `${got} Hz frente a ${want} Hz (periodo ${period} T)`).toBeLessThan(0.005);
  });
});
