// Lista los bloques de la cinta (flag, longitud, cabecera) y extrae cada uno a work/blk-*.bin.
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK, readTzx, tapBlocks, tzxToTap } from "./common";

it("bloques", () => {
  const out: string[] = [];
  for (const side of [1, 2]) {
    const blocks = tapBlocks(tzxToTap(readTzx(`Sootland - Side ${side}.tzx`)));
    blocks.forEach((b, i) => {
      const flag = b[0]!;
      let d = `S${side}#${i} flag=${flag.toString(16)} len=${b.length - 2}`;
      if (flag === 0 && b.length === 19) {
        const name = String.fromCharCode(...b.subarray(2, 12));
        const w = (o: number) => b[o]! | (b[o + 1]! << 8);
        d += ` hdr type=${b[1]} "${name}" len=${w(12)} p1=${w(14)} p2=${w(16)}`;
      }
      out.push(d);
      writeFileSync(join(WORK, `blk-s${side}-${i}.bin`), b);
    });
  }
  writeFileSync(join(WORK, "blocks.txt"), out.join("\n") + "\n");
});
