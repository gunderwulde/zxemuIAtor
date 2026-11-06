// Imágenes de memoria de 64 K justo después de cada LD-BYTES, con quién lo llama.
import { it } from "vitest";
import { KEY, STOP, bootSootland, newCore, press, runFrames, save } from "./common";

it("etapas", async () => {
  const core = await newCore();
  bootSootland(core);
  const ram = () => core.ram();
  const log: string[] = [];
  let n = 0;
  const watch = (frames: number) => {
    core.x.zx_bp_set(0x0556, 1);
    for (let i = 0; i < frames; i++) {
      while (core.runFrame() === STOP.BREAKPOINT) {
        const r = core.regs.snapshot();
        const m = ram();
        const ret = m[r.sp]! | (m[r.sp + 1]! << 8);
        const a = r.af >> 8;
        log.push(`#${n} LD-BYTES A=${a.toString(16)} IX=${r.ix.toString(16)} DE=${r.de} caller=${ret.toString(16)} sp=${r.sp.toString(16)} pc→`);
        core.x.zx_bp_clear_all();
        // ejecutar hasta volver al llamador
        let guard = 0;
        while (core.regs.get16("pc") !== ret && guard++ < 100000) core.x.zx_step();
        log[log.length - 1] += core.regs.get16("pc").toString(16);
        save(`stage-${n}.mem`, ram().slice());
        n++;
        core.x.zx_bp_set(0x0556, 1);
      }
    }
    core.x.zx_bp_clear_all();
  };
  watch(2);                 // BASIC + loader.bin (la ROM lo carga con LD-BYTES: aún no hay RAM del juego)
  runFrames(core, 300); press(core, [KEY.SPACE], 10); runFrames(core, 1000); press(core, [KEY.SPACE], 10); runFrames(core, 700);
  press(core, [[3, 1]], 10); runFrames(core, 80);
  core.x.zx_key(4, 0, 1);
  watch(300);
  core.x.zx_key(4, 0, 0);
  runFrames(core, 200); press(core, [KEY.SPACE], 10);
  watch(60);
  console.log(log.join("\n"));
});
