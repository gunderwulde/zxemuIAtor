// Fondos de los niveles: cada uno son 0x1200 B = 4096 de bitmap (2/3 de pantalla) + 512 de atributos.
// Hoja con los 4 de cada nivel (nivel = una fila de la hoja, cuerpo en work/blk-s2-{1,3,5,7}.bin).
import { it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scrToRgba } from "../../web/src/res/scr";
import { WORK, png, save } from "./common";

const topToScr = (top: Uint8Array): Uint8Array => {
  const s = new Uint8Array(6912);
  s.set(top.subarray(0, 4096), 0);
  s.set(top.subarray(4096, 4608), 6144);
  return s;
};

it("fondos", () => {
  const SW = 1024;
  const sheet = new Uint8ClampedArray(SW * 512 * 4);
  for (let lvl = 0; lvl < 4; lvl++) {
    const body = new Uint8Array(readFileSync(join(WORK, `blk-s2-${1 + lvl * 2}.bin`))).subarray(1, -1);
    for (let n = 0; n < 4; n++) {
      const rgba = scrToRgba(topToScr(body.subarray(n * 0x1200, (n + 1) * 0x1200)));
      for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) {
        const s = (y * 256 + x) * 4, d = ((lvl * 128 + y) * SW + (n * 256 + x)) * 4;
        sheet[d] = rgba[s]!; sheet[d + 1] = rgba[s + 1]!; sheet[d + 2] = rgba[s + 2]!; sheet[d + 3] = 255;
      }
    }
  }
  save("bg-sheet.png", png(new Uint8Array(sheet.buffer), SW, 512));
});
