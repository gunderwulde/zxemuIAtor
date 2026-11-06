import { it } from "vitest";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK, newCore, runFrames, shot } from "./common";

it("captura de un SNA", async () => {
  const core = await newCore();
  const [sna, out] = (process.env.SHOT ?? "trace-game.sna,shot.png").split(",");
  core.loadSna(new Uint8Array(readFileSync(join(WORK, sna!))));
  const log = join(WORK, "pc.txt");
  writeFileSync(log, "");
  for (let i = 0; i < 6; i++) {
    runFrames(core, 50);
    appendFileSync(log, `${i} pc ${core.regs.get16("pc").toString(16)} sp ${core.regs.get16("sp").toString(16)}\n`);
  }
  shot(core, out!);
});
