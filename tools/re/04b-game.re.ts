// Cobertura de la partida: arranque sin trazar (con la trampa de LD-BYTES, igual que 03-stages),
// SNA con el nivel 1 ya cargado, y desde ahí traza con teclas pseudoaleatorias.
import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KEY, WORK, bootSootland, newCore, press, runFrames, save, shot } from "./common";
import { Tracer } from "./trace";

it("traza de la partida", async () => {
  const core = await newCore();
  bootSootland(core);
  runFrames(core, 2);
  runFrames(core, 300); press(core, [KEY.SPACE], 10); runFrames(core, 1000); press(core, [KEY.SPACE], 10); runFrames(core, 700);
  press(core, [[3, 1]], 10); runFrames(core, 80);
  core.x.zx_key(4, 0, 1); runFrames(core, 300); core.x.zx_key(4, 0, 0);
  runFrames(core, 200); press(core, [KEY.SPACE], 10); runFrames(core, 400);
  shot(core, "h0.png");
  save("level1.sna", core.saveSna());

  const t = new Tracer(core);
  let seed = 12345;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8;
  const pool: [number, number][] = [[2, 0], [5, 0], [5, 1], [1, 0], [1, 1], [7, 0], [7, 2], [2, 1], [6, 0], [0, 1], [3, 0], [4, 1], [4, 0]];
  const held = new Set<number>();
  const mix = () => {
    const i = rnd() % pool.length, k = pool[i]!;
    if (held.has(i)) { held.delete(i); core.x.zx_key(k[0], k[1], 0); } else { held.add(i); core.x.zx_key(k[0], k[1], 1); }
  };
  for (let s = 0; s < 4000; s++) {
    if (s % 6 === 0) mix();
    t.frame();
    if (s % 1000 === 999) shot(core, `h${1 + (s - 999) / 1000}.png`);
  }
  save("trace-game.sna", core.saveSna());
  writeFileSync(join(WORK, "cov-game.bin"), t.flags);
  writeFileSync(join(WORK, "starts-game.bin"), t.starts);
  void readFileSync;
});
