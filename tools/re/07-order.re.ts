// Orden en que la ejecución entra por primera vez en cada página de código (≥ 0x4000).
import { it } from "vitest";
import { KEY, newCore, readTzx, runFrames, tzxToTap } from "./common";

it("orden de primeras entradas", async () => {
  const core = await newCore();
  const tape = Uint8Array.from([...tzxToTap(readTzx("Sootland - Side 1.tzx")), ...tzxToTap(readTzx("Sootland - Side 2.tzx"))]);
  core.x.zx_reset(); runFrames(core, 150); core.loadTap(tape);
  const seen = new Map<number, string>();
  let last = -1, step = 0;
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) {
      const f0 = core.x.zx_frame_count();
      while (core.x.zx_frame_count() === f0) {
        const pc = core.regs.get16("pc");
        const pg = pc >> 8;
        if (pc >= 0x4000 && pg !== last) { if (!seen.has(pg)) seen.set(pg, `${step}:${pc.toString(16)}`); last = pg; }
        core.x.zx_step(); step++;
      }
    }
  };
  const pressT = (keys: (readonly [number, number])[], n = 10) => {
    for (const [r, b] of keys) core.x.zx_key(r, b, 1); frames(n);
    for (const [r, b] of keys) core.x.zx_key(r, b, 0); frames(n);
  };
  pressT([KEY.J], 4); pressT([KEY.SYM, KEY.P], 4); pressT([KEY.SYM, KEY.P], 4); pressT([KEY.ENTER], 4);
  frames(500);
  const mark = (s: string) => console.log("--", s, "paso", step);
  mark("tras 500 frames"); pressT([KEY.SPACE]); frames(600); mark("tras espacio"); pressT([[3, 1]], 10); frames(80);
  core.x.zx_key(4, 0, 1); frames(150); core.x.zx_key(4, 0, 0); mark("tras 0"); frames(250);
  console.log([...seen].map(([p, w]) => `${p.toString(16)}00@${w}`).join(" "));
});
