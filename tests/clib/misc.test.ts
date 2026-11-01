// L1: string.h, stdlib.h (rand/srand/abs), wait_frame/frames e IM 2 en el núcleo real.
// Oráculos: C99 (valores escritos a mano), modelo independiente del xorshift (7,9,8)
// de 16 bits (Marsaglia; terna de la implementación de J. Metcalf), docs §2 (INT
// por frame) y bytes de la ROM (386Eh–3CFFh = FFh, 0000h = F3h).
import { describe, expect, it } from "vitest";
import { call, keep, program, run } from "./harness";

const s16 = (v: number) => (v << 16) >> 16;

describe("string.h", () => {
  it("memcpy / memset / memcmp", async () => {
    const r = await run(program([
      call("memcpy", "dst", "src", 5), keep(0),
      call("memcpy", "dst+10", "src", 0),
      call("memset", "dst+20", 0x41, 7), keep(1),
      call("memset", "dst+30", 0x42, 1),
      call("memset", "dst+31", 0x43, 0),
      call("memcmp", "src", "src", 5), keep(2),
      call("memcmp", "s1", "s2", 3), keep(3),
      call("memcmp", "s2", "s1", 3), keep(4),
      call("memcmp", "s1", "s2", 2), keep(5),
    ].join("\n"), [
      'src: db "HELLO"',
      "dst: ds 40,0EEh",
      'zz:  db 0',
      's1:  db "abc"',
      's2:  db "abz"',
    ].join("\n")));
    const ram = r.ram(), dst = r.sym("dst");
    expect([...ram.slice(dst, dst + 6)]).toEqual([72, 69, 76, 76, 79, 0xee]);
    expect(r.res(0)).toBe(dst);
    expect(ram[dst + 10]).toBe(0xee);
    expect([...ram.slice(dst + 19, dst + 28)]).toEqual([0xee, 65, 65, 65, 65, 65, 65, 65, 0xee]);
    expect(r.res(1)).toBe(dst + 20);
    expect([ram[dst + 30], ram[dst + 31]]).toEqual([0x42, 0xee]);
    expect(s16(r.res(2))).toBe(0);
    expect(s16(r.res(3))).toBe(99 - 122);
    expect(s16(r.res(4))).toBe(122 - 99);
    expect(s16(r.res(5))).toBe(0);
  });

  it("strlen / strcpy / strcmp", async () => {
    const r = await run(program([
      call("strlen", "se"), keep(0), call("strlen", "sh"), keep(1),
      call("strcpy", "buf", "sh"), keep(2),
      call("strcmp", "a1", "a2"), keep(3), call("strcmp", "a2", "a1"), keep(4),
      call("strcmp", "a3", "a1"), keep(5), call("strcmp", "a1", "a1"), keep(6), call("strcmp", "se", "se"), keep(7),
    ].join("\n"), [
      'se:  db 0', 'sh:  db "hello",0', 'a1:  db "abc",0', 'a2:  db "abd",0', 'a3:  db "ab",0', 'buf: ds 8,0EEh',
    ].join("\n")));
    expect(r.res(0)).toBe(0);
    expect(r.res(1)).toBe(5);
    const buf = r.sym("buf");
    expect(r.res(2)).toBe(buf);
    expect([...r.ram().slice(buf, buf + 7)]).toEqual([104, 101, 108, 108, 111, 0, 0xee]);
    expect(s16(r.res(3))).toBe(-1);
    expect(s16(r.res(4))).toBe(1);
    expect(s16(r.res(5))).toBe(-99);
    expect(s16(r.res(6))).toBe(0);
    expect(s16(r.res(7))).toBe(0);
  });
});

describe("stdlib.h", () => {
  function xorshift(x: number): number {
    x ^= (x << 7) & 0xffff;
    x ^= x >> 9;
    x ^= (x << 8) & 0xffff;
    return x;
  }

  it("rand sigue el xorshift (7,9,8) y devuelve 0..32767; srand(0) = srand(1)", async () => {
    const body = [call("srand", 12345)];
    for (let k = 0; k < 8; k++) body.push(call("rand"), keep(k));
    body.push(call("srand", 0), call("rand"), keep(8));
    const r = await run(program(body.join("\n")));
    let x = 12345;
    for (let k = 0; k < 8; k++) {
      x = xorshift(x);
      expect(r.res(k), `rand #${k}`).toBe(x & 0x7fff);
    }
    expect(r.res(8)).toBe(xorshift(1) & 0x7fff);
  });

  it("el generador recorre los 65535 estados no nulos (modelo)", () => {
    let x = 1, n = 0;
    do { x = xorshift(x); n++; } while (x !== 1 && n < 70000);
    expect(n).toBe(65535);
  });

  it("abs", async () => {
    const r = await run(program([call("abs", -5 & 0xffff), keep(0), call("abs", 7), keep(1), call("abs", 0x8000), keep(2), call("abs", 0), keep(3)].join("\n")));
    expect([r.res(0), r.res(1), r.res(2), r.res(3)]).toEqual([5, 7, 0x8000, 0]);
  });
});

describe("tiempo e interrupciones", () => {
  it("wait_frame espera una INT: 5 llamadas = 5 frames de FRAMES", async () => {
    const r = await run(program([
      call("wait_frame"), call("frames"), keep(0),
      call("wait_frame"), call("wait_frame"), call("wait_frame"), call("wait_frame"), call("wait_frame"),
      call("frames"), keep(1),
    ].join("\n")));
    expect((r.res(1) - r.res(0)) & 0xffff).toBe(5);
  });

  it("im2_install llama a la función en cada frame (I = 39h, IM 2), encadena la INT de la ROM y im2_remove lo deshace", async () => {
    const before = await run(program("        nop"));
    const udg = [...before.ram().slice(0xfff4, 0x10000)];
    const r = await run(program([
      call("wait_frame"),
      call("frames"), keep(0),
      call("im2_install", "isr"),
      "        ld a,i\n        ld (res+20),a",
      ...Array(10).fill(call("wait_frame")),
      call("im2_remove"),
      call("frames"), keep(1),
      "        ld a,i\n        ld (res+22),a",
      call("wait_frame"), call("wait_frame"),
    ].join("\n"), [
      "isr:    ld hl,(count)",
      "        inc hl",
      "        ld (count),hl",
      "        ret",
      "count:  dw 0",
    ].join("\n")));
    const count = r.peek16(r.sym("count"));
    // 10 HALT con IM 2: 10 INT (una más si cae justo entre im2_install y el primer HALT).
    expect(count).toBeGreaterThanOrEqual(10);
    expect(count).toBeLessThanOrEqual(11);
    // La INT de la ROM sigue contando FRAMES con IM 2: mismo número de INT.
    expect((r.res(1) - r.res(0)) & 0xffff).toBe(count);
    expect(r.ram()[r.sym("res") + 20]).toBe(0x39);
    expect(r.ram()[r.sym("res") + 22]).toBe(0x3f);
    expect(r.p.regs.get8("im")).toBe(1);
    // Tras quitarla, la función ya no se llama y FFF4h–FFFFh vuelven a ser los del UDG.
    expect(r.peek16(r.sym("count"))).toBe(count);
    expect([...r.ram().slice(0xfff4, 0x10000)]).toEqual(udg);
  });

  it("la tabla de vectores de la ROM: 3900h–3A00h = FFh y 0000h = F3h (JR −13 desde FFFFh → FFF4h)", async () => {
    const r = await run(program("        nop"));
    const ram = r.ram();
    expect([...ram.slice(0x3900, 0x3a01)].every((b) => b === 0xff)).toBe(true);
    expect(ram[0]).toBe(0xf3);
    expect((0xffff + 2 + s16(0xfff3)) & 0xffff).toBe(0xfff4);
  });
});
