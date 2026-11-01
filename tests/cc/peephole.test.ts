// K1: reglas del peephole (casos escritos a mano) y su efecto medido.
import { describe, expect, it } from "vitest";
import { peephole } from "../../web/src/cc/peephole";
import { runC } from "./harness";

const I = (s: string) => "        " + s;
const run = (lines: string[]) => { const l = lines.slice(); peephole(l); return l; };

describe("reglas", () => {
  it("push/pop redundantes y ex de,hl doble", () => {
    expect(run([I("push hl"), I("pop hl"), I("ex de,hl"), I("ex de,hl"), I("ret")])).toEqual([I("ret")]);
    expect(run([I("push hl"), I("pop de"), I("ret")])).toEqual([I("ld d,h"), I("ld e,l"), I("ret")]);
  });

  it("carga tras guardar el mismo sitio", () => {
    expect(run([I("ld (_x),hl"), I("ld hl,(_x)"), I("ret")])).toEqual([I("ld (_x),hl"), I("ret")]);
    expect(run([I("ld (ix-2),l"), I("ld (ix-1),h"), I("ld l,(ix-2)"), I("ld h,(ix-1)"), I("ret")])).toEqual([I("ld (ix-2),l"), I("ld (ix-1),h"), I("ret")]);
    // Una etiqueta entre medias es un punto de entrada: no se toca.
    const keep = [I("ld (_x),hl"), ".c1:", I("ld hl,(_x)"), I("ret")];
    expect(run(keep)).toEqual(keep);
  });

  it("saltos: al siguiente, condicional sobre incondicional, y código muerto", () => {
    expect(run([I("jp .c1"), ".c1:", I("ret")])).toEqual([".c1:", I("ret")]);
    expect(run([I("jp z,.c1"), I("jp .c2"), ".c1:", I("inc hl"), ".c2:", I("ret")])).toEqual([I("jp nz,.c2"), ".c1:", I("inc hl"), ".c2:", I("ret")]);
    expect(run([I("ret"), I("ld hl,1"), I("jp .c3"), ".c2:", I("ret")])).toEqual([I("ret"), ".c2:", I("ret")]);
  });

  it("las marcas de línea C no impiden las reglas; los bloques __asm son una barrera", () => {
    expect(run([I("push hl"), ";#m.c:3: x", I("pop hl"), I("ret")])).toEqual([";#m.c:3: x", I("ret")]);
    const asm = [I("jp .c1"), ";{asm", I("ld a,1"), ";}asm", ".c1:", I("ret")];
    expect(run(asm)).toEqual(asm);
    const dead = [I("ret"), ";{asm", I("nop"), ";}asm", I("ret")];
    expect(run(dead)).toEqual(dead);
  });
});

const PROGRAMS: Record<string, string> = {
  fib: `int fib(int n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); } int main(void) { return fib(15); }`,
  sieve: `char flags[1000]; int main(void) { int i, k, count = 0;
    for (i = 2; i < 1000; i++) flags[i] = 1;
    for (i = 2; i < 1000; i++) if (flags[i]) { count++; for (k = i + i; k < 1000; k += i) flags[k] = 0; }
    return count; }`,
  bubble: `int a[64]; int main(void) { int i, j, t; unsigned s = 1;
    for (i = 0; i < 64; i++) { s = s * 75 + 74; a[i] = s; }
    for (i = 0; i < 63; i++) for (j = 0; j < 63 - i; j++) if (a[j] > a[j + 1]) { t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; }
    for (i = 0; i < 63; i++) if (a[i] > a[i + 1]) return -1;
    return a[0]; }`,
};

describe("efecto medido (bytes y T-states con y sin peephole)", () => {
  it("mismo resultado, menos bytes y menos T-states", async () => {
    const rows: string[] = [];
    for (const [name, src] of Object.entries(PROGRAMS)) {
      const off = await runC(src, { peephole: false });
      const on = await runC(src);
      expect(on.ret).toBe(off.ret);
      expect(on.bytes).toBeLessThanOrEqual(off.bytes);
      expect(on.t).toBeLessThanOrEqual(off.t);
      rows.push(`${name}: ret=${on.ret} bytes ${off.bytes} -> ${on.bytes}, T ${off.t} -> ${on.t} (${((1 - on.t / off.t) * 100).toFixed(1)} %)`);
    }
    // Esperados a mano: fib(15) = 610; primos < 1000 = 168.
    expect((await runC(PROGRAMS.fib!)).ret).toBe(610);
    expect((await runC(PROGRAMS.sieve!)).ret).toBe(168);
    console.log(rows.join("\n"));
  });
});
