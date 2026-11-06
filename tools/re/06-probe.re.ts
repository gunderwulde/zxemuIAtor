import { it } from "vitest";
import { KEY, bootSootland, newCore, press, runFrames } from "./common";
it("quién ejecuta EADA", async () => {
  const core = await newCore();
  bootSootland(core);
  const ram = core.ram();
  const hist: number[] = [];
  let found = false;
  for (let f = 0; f < 3000 && !found; f++) {
    if (f === 300) press(core, [KEY.SPACE], 10);
    if (f === 1300) press(core, [KEY.SPACE], 10);
    const f0 = core.x.zx_frame_count();
    while (core.x.zx_frame_count() === f0) {
      const pc = core.regs.get16("pc");
      hist.push(pc); if (hist.length > 30) hist.shift();
      if (pc >= 0xeada && pc < 0xeb20) { console.log("EJECUTA", pc.toString(16), "frame", f, "historial", hist.map((x) => x.toString(16)).join(" "), "sp", core.regs.get16("sp").toString(16)); found = true; break; }
      core.x.zx_step();
    }
  }
  console.log("fin", found);
});
