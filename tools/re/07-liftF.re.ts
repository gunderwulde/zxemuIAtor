// Bloque final (3292 B, flag FF, se carga en C350h y salta a CE72h) y cabecera de nivel 1.
import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DIR, WORK } from "./common";
import { lift } from "./lift";

it("bloque final", () => {
  const F = new Uint8Array(readFileSync(join(WORK, "blk-s2-8.bin"))).subarray(1, -1);
  const r = lift({ name: "final", bytes: F, phys: 0xc350, run: 0xc350, seeds: [0xce72] }, {});
  writeFileSync(join(DIR, "lift", "final.asm"), r.text);
  writeFileSync(join(WORK, "liftF.txt"), `F: ${F.length} B, código ${r.codeBytes} datos ${r.dataBytes}\n` + r.layout.map((s) => `${s.kind === "code" ? "C" : "D"} ${s.a.toString(16)}+${s.n}`).join("\n") + "\n");
  const H = new Uint8Array(readFileSync(join(WORK, "blk-s2-0.bin"))).subarray(1, -1);
  const tail = [...H.subarray(0x408)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  writeFileSync(join(WORK, "hdr1tail.txt"), `${H.length}\n${tail}\n`);
});
