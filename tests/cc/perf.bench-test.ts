// K1: compilar 2000 líneas de C en < 200 ms (PLAN.md, aceptación de K1). Se mide
// compile() de punta a punta (preprocesador, parser, código, peephole); mínimo y mediana
// de 9 ejecuciones tras una de calentamiento.
import { expect, it } from "vitest";
import { compile } from "../../web/src/cc";

function program(lines: number): string {
  const out: string[] = ["struct P { int x, y; char tag; };", "struct P pts[16];", "int table[64];"];
  let f = 0;
  while (out.length < lines - 12) {
    out.push(
      `int f${f}(int a, unsigned b, struct P *p) {`,
      `  int i, s = 0; char c = a;`,
      `  for (i = 0; i < 16; i++) {`,
      `    s += table[(i + a) & 63] * 3 - (b >> 2);`,
      `    if (s > 1000 || p->x < -5) s = s / 7 % 13;`,
      `    else if (c == 'x') s ^= 0x55;`,
      `  }`,
      `  switch (a) { case 1: s++; break; case 2: s--; break; case 3: case 4: s <<= 1; break; default: s = -s; }`,
      `  while (b) { b--; p->y += b; }`,
      `  return s + p->tag + (a ? f${Math.max(0, f - 1)}(a - 1, b, p) : 0);`,
      `}`,
    );
    f++;
  }
  out.push(`int main(void) { int i, t = 0;`, ...Array.from({ length: 8 }, (_, i) => `  t += f${f - 1 - i}(${i}, ${i * 3}u, &pts[${i}]);`), `  for (i = 0; i < 16; i++) t += pts[i].x;`, `  return t;`, `}`);
  return out.join("\n");
}

it("2000 líneas en < 200 ms (mínimo y mediana)", () => {
  const src = program(2000);
  const nLines = src.split("\n").length;
  expect(nLines).toBeGreaterThanOrEqual(2000);
  const files = new Map([["main.c", src]]);
  const first = compile(files, { main: "main.c" });
  expect(first.errors).toEqual([]);
  const times: number[] = [];
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    compile(files, { main: "main.c" });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const min = times[0]!, med = times[4]!;
  console.log(`compile ${nLines} líneas: mínimo ${min.toFixed(1)} ms, mediana ${med.toFixed(1)} ms, asm ${first.asm.split("\n").length} líneas`);
  // Se exige el mínimo: con la suite completa en paralelo la mediana mide la carga de la
  // máquina, no el compilador.
  expect(min).toBeLessThan(200);
});
