// Cobertura por fases. Intro = loader.bin desde su entrada hasta el JP 0EA60h del stub de
// carga (0xAFFD); juego = motor ya cargado: menú, carga del nivel y partida (teclas al azar).
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { KEY, WORK, newCore, readTzx, runFrames, save, shot, tzxToTap } from "./common";
import { Tracer } from "./trace";

it("traza por fases", async () => {
  const core = await newCore();
  const tape = Uint8Array.from([...tzxToTap(readTzx("Sootland - Side 1.tzx")), ...tzxToTap(readTzx("Sootland - Side 2.tzx"))]);
  core.x.zx_reset();
  runFrames(core, 150);
  core.loadTap(tape);
  const t = new Tracer(core);
  const frames = (n: number) => { for (let i = 0; i < n; i++) t.frame(); };
  const pressT = (keys: (readonly [number, number])[], n = 10) => {
    for (const [r, b] of keys) core.x.zx_key(r, b, 1); frames(n);
    for (const [r, b] of keys) core.x.zx_key(r, b, 0); frames(n);
  };
  // LOAD "" (J, SYM+P, SYM+P, ENTER) con trazado: así la intro se ve desde su primera instrucción.
  pressT([KEY.J], 4); pressT([KEY.SYM, KEY.P], 4); pressT([KEY.SYM, KEY.P], 4); pressT([KEY.ENTER], 4);
  // Intro: música, menú (elige 2 = teclado) y 0 = empezar, que carga el motor con el stub.
  frames(500); pressT([KEY.SPACE]); frames(600);
  save("trace-menu.sna", core.saveSna());
  pressT([[3, 1]], 10); frames(80);
  core.x.zx_key(4, 0, 1);
  const ram = core.ram();
  let guard = 0;
  while (!(core.regs.get16("pc") === 0xea60 && ram[0xea60] === 0xaf) && guard++ < 80_000_000) t.run(1);   // entrada del motor (B)
  core.x.zx_key(4, 0, 0);
  console.log("motor alcanzado tras", guard, "pasos; pc", core.regs.get16("pc").toString(16));
  writeFileSync(join(WORK, "cov-intro.bin"), t.flags);
  t.flags.fill(0); t.starts.fill(0);
  frames(300);
  // La carga del nivel va sin trazar: con zx_step no actúa la trampa de LD-BYTES y por pulsos tardaría minutos.
  core.x.zx_key(KEY.SPACE[0], KEY.SPACE[1], 1);
  for (let i = 0; i < 10; i++) core.runFrame();
  core.x.zx_key(KEY.SPACE[0], KEY.SPACE[1], 0);
  for (let i = 0; i < 300; i++) core.runFrame();
  frames(100); shot(core, "g0.png");
  let seed = 12345;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8;
  const pool: [number, number][] = [[2, 0], [5, 0], [5, 1], [1, 0], [1, 1], [7, 0], [7, 2], [2, 1], [6, 0], [0, 1], [3, 0], [4, 1]];
  const held = new Set<number>();
  const mix = () => {
    const i = rnd() % pool.length, k = pool[i]!;
    if (held.has(i)) { held.delete(i); core.x.zx_key(k[0], k[1], 0); } else { held.add(i); core.x.zx_key(k[0], k[1], 1); }
  };
  for (let s = 0; s < 3000; s++) { if (s % 6 === 0) mix(); t.frame(); if (s % 500 === 499) shot(core, `g${1 + (s - 499) / 500}.png`); }
  save("trace-game.sna", core.saveSna());
  writeFileSync(join(WORK, "cov-game.bin"), t.flags);
  console.log("steps", t.steps);
});
