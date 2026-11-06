// Motor (bloque B, 10370 bytes en D778h) con sus tres piezas reubicadas por el stub de carga.
import { it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DIR, WORK, readTzx, tapBlocks, tzxToTap } from "./common";
import { lift, type Region } from "./lift";

const f = (n: string) => new Uint8Array(readFileSync(join(WORK, n)));
it("estadísticas de B", () => {
  const side1 = tapBlocks(tzxToTap(readTzx("Sootland - Side 1.tzx")));
  const B = side1[4]!.slice(1, -1);
  const st = f("starts-game.bin");
  const tr = (lo: number, hi: number) => { const o: number[] = []; for (let a = lo; a < hi; a++) if (st[a]) o.push(a); return o; };
  const pieces: Region[] = [
    { name: "B1", bytes: B.slice(0, 0x900), phys: 0xd778, run: 0xcf08, seeds: [] },
    { name: "B2 fuente", bytes: B.slice(0x900, 0xc00), phys: 0xe078, run: 0xdd00, seeds: [] },
    { name: "B3", bytes: B.slice(0xc00, 0x12e8), phys: 0xe378, run: 0xc350, seeds: [], traced: tr(0xc350, 0xca38) },
    { name: "B4 motor", bytes: B.slice(0x12e8), phys: 0xea60, run: 0xea60, seeds: [0xea60, 0xea8d], traced: tr(0xea60, 0x10000) },
  ];
  const lines: string[] = [];
  for (const p of pieces) {
    const r = lift(p, {});
    lines.push(`${p.name}: código ${r.codeBytes} datos ${r.dataBytes}\n${r.layout.map((s) => `  ${s.kind === "code" ? "C" : "D"} ${s.a.toString(16)}+${s.n}`).join("\n")}`);
    writeFileSync(join(DIR, "lift", `B-${p.name.split(" ")[0]}.asm`), r.text);
  }
  writeFileSync(join(WORK, "liftB.txt"), lines.join("\n"));
  expect(B.length).toBe(10370);
});
