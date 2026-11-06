// Genera el ensamblador de Sootland desde los bloques de la cinta + la traza, y lo verifica.
import { it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assemble } from "../../web/src/asm";
import { DIR, WORK, readTzx, tapBlocks, tzxToTap } from "./common";
import { lift, type Names, type Region } from "./lift";

const OUT = join(DIR, "lift");
mkdirSync(OUT, { recursive: true });

const side1 = tapBlocks(tzxToTap(readTzx("Sootland - Side 1.tzx")));
const A = side1[3]!.slice(1, -1);   // loader.bin, 20535 bytes en AFC8h
const B = side1[4]!.slice(1, -1);   // motor, 10370 bytes en D778h (sin cabecera)

const starts = (file: string, lo: number, hi: number) => {
  const f = new Uint8Array(readFileSync(join(WORK, file)));
  const out: number[] = [];
  for (let a = lo; a < hi; a++) if (f[a]! & 1 && !(f[a]! & 8)) out.push(a);
  return out;
};

function verify(name: string, text: string, regions: Region[]): void {
  const r = assemble(text, { org: regions[0]!.phys });
  const errs = r.errors.filter((e) => e.severity === "error");
  expect(errs.map((e) => `${e.line}:${e.col} ${e.msg}`).slice(0, 5), `${name}: errores de ensamblado`).toEqual([]);
  const mem = new Int16Array(65536).fill(-1);
  for (const s of r.segments) s.bytes.forEach((b, i) => { mem[s.addr + i] = b; });
  let bad = 0, first = -1;
  for (const g of regions) for (let i = 0; i < g.bytes.length; i++) if (mem[g.phys + i] !== g.bytes[i]) { bad++; if (first < 0) first = g.phys + i; }
  expect(bad, `${name}: ${bad} bytes distintos (primero en ${first.toString(16)})`).toBe(0);
}

const extHeader = (ex: Map<number, string>) =>
  [...ex].sort((a, b) => a[0] - b[0]).map(([a, n]) => `${n.padEnd(14)} equ 0${a.toString(16).toUpperCase().padStart(4, "0")}h`).join("\n") + "\n";

it("loader.bin (bloque A)", () => {
  const names: Names = {};
  const region: Region = {
    name: "loader.bin", bytes: A, phys: 0xafc8, run: 0xafc8,
    seeds: [0xea60, 0xafc8],
  };
  const res = lift(region, names);
  const text = `; Generado por tools/re (ingeniería inversa de Sootland)\n${extHeader(res.externs)}\n${res.text}`;
  writeFileSync(join(OUT, "loader.asm"), text);
  writeFileSync(join(WORK, "liftA.txt"), `A: código ${res.codeBytes} datos ${res.dataBytes} etiquetas ${res.labels.size}\n` +
    res.layout.map((s) => `${s.kind === "code" ? "C" : "D"} ${s.a.toString(16)}+${s.n}`).join("\n") + "\n");
  verify("loader", text, [region]);
});
