// Arranca Sootland como en sootland.test.ts y guarda un SNA en cada fase.
import { it } from "vitest";
import { KEY, STOP, bootSootland, newCore, press, runFrames, save, shot } from "./common";

it("fases de arranque", async () => {
  const core = await newCore();
  bootSootland(core);
  runFrames(core, 300);
  save("a-music.sna", core.saveSna()); shot(core, "a.png");
  press(core, [KEY.SPACE], 10);
  runFrames(core, 1000);
  press(core, [KEY.SPACE], 10);
  runFrames(core, 700);
  save("b-menu.sna", core.saveSna()); shot(core, "b.png");
  press(core, [[3, 1]], 10);
  runFrames(core, 80);
  core.x.zx_key(4, 0, 1);
  core.x.zx_bp_set(0x0556, 1);
  const log: string[] = [];
  for (let i = 0; i < 400 && log.length < 3; i++) {
    if (core.runFrame() === STOP.BREAKPOINT) {
      const r = core.regs.snapshot();
      log.push(`A=${(r.af >> 8).toString(16)} IX=${r.ix.toString(16)} DE=${r.de}`);
      if (log.length < 3) { core.x.zx_step(); }
    }
  }
  core.x.zx_key(4, 0, 0);
  console.log("LD-BYTES:", log);
  core.x.zx_bp_clear_all();
  save("c-loadlevel.sna", core.saveSna()); shot(core, "c.png");
  runFrames(core, 200);
  press(core, [KEY.SPACE], 10);
  runFrames(core, 300);
  save("d-game.sna", core.saveSna()); shot(core, "d.png");
});
