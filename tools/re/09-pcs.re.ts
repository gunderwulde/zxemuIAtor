// Histograma de PCs por páginas de 256 B durante unos frames de un SNA.
import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK, newCore, runFrames } from "./common";

it("histograma de PC", async () => {
  const core = await newCore();
  const [sna, skip] = (process.env.SNA ?? "level1.sna,0").split(",");
  core.loadSna(new Uint8Array(readFileSync(join(WORK, sna!))));
  runFrames(core, +skip!);
  const h = new Map<number, number>();
  for (let i = 0; i < 400000; i++) {
    const pc = core.regs.get16("pc");
    h.set(pc >> 8, (h.get(pc >> 8) ?? 0) + 1);
    core.x.zx_step();
  }
  const out = [...h].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([p, n]) => `${(p << 8).toString(16)}: ${n}`).join("\n");
  writeFileSync(join(WORK, "pcs.txt"), out + "\n");
});
