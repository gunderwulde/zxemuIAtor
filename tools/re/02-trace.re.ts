// Juega una sesión de Sootland trazando y guarda la cobertura.
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { KEY, STOP, WORK, bootSootland, newCore, press, runFrames, save, shot } from "./common";
import { Tracer } from "./trace";

it("traza", async () => {
  const core = await newCore();
  bootSootland(core);
  const t = new Tracer(core);
  const frames = (n: number) => { for (let i = 0; i < n; i++) t.frame(); };
  const pressT = (keys: (readonly [number, number])[], n = 10) => {
    for (const [r, b] of keys) core.x.zx_key(r, b, 1); frames(n);
    for (const [r, b] of keys) core.x.zx_key(r, b, 0); frames(n);
  };
  const t0 = Date.now();
  frames(300);
  pressT([KEY.SPACE]);
  frames(1000);
  pressT([KEY.SPACE]);
  frames(700);
  pressT([[3, 1]]);
  frames(80);
  core.x.zx_key(4, 0, 1);
  frames(120);   // la carga por trampa del nivel ocurre dentro del frame
  core.x.zx_key(4, 0, 0);
  frames(200);
  pressT([KEY.SPACE]);
  frames(100);
  save("trace-pre-game.sna", core.saveSna());
  console.log("pasos", t.steps, "ms", Date.now() - t0);
  writeFileSync(join(WORK, "cov-1.bin"), t.flags);
  writeFileSync(join(WORK, "starts-1.bin"), t.starts);
  shot(core, "t.png");
});
