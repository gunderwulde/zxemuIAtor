// L1: teclado (key_pressed, in_key, wait_key) y joysticks en el núcleo real.
// Oráculo: matriz de docs/zx48-hardware.md §6 (vía zx_key de tests/util/keys.ts),
// símbolos impresos en el teclado del 48K y tabla SYM-CODES de la ROM (026Ah).
import { describe, expect, it } from "vitest";
import { call, hold, keep, program, run } from "./harness";

async function withKeys(keys: string[], body: string) {
  const r = await run(program(body), { run: false });
  hold(r.p, keys, true);
  r.untilFin();
  return r;
}

describe("in_key", () => {
  const cases: [string[], number][] = [
    [[], 0],
    [["G"], "g".charCodeAt(0)],
    [["CAPS", "G"], "G".charCodeAt(0)],
    [["B"], "b".charCodeAt(0)],
    [["5"], "5".charCodeAt(0)],
    [["CAPS", "5"], "5".charCodeAt(0)],
    [["ENTER"], 13],
    [["SPACE"], 32],
    [["CAPS", "0"], 8],
    [["CAPS", "SPACE"], 27],
    [["SYM", "P"], '"'.charCodeAt(0)],
    [["SYM", "Z"], ":".charCodeAt(0)],
    [["SYM", "X"], 0x60],   // £ en el juego de caracteres del Spectrum
    [["SYM", "B"], "*".charCodeAt(0)],
    [["SYM", "2"], "@".charCodeAt(0)],
    [["SYM", "7"], "'".charCodeAt(0)],
    [["SYM", "A"], "~".charCodeAt(0)],
    [["SYM", "W"], 0],      // <> no es un carácter
    [["CAPS"], 0],
    [["SYM"], 0],
    [["CAPS", "SYM"], 0],
  ];
  for (const [keys, want] of cases) {
    it(`[${keys.join("+")}] → ${want}`, async () => {
      const r = await withKeys(keys, call("in_key") + "\n" + keep(0));
      expect(r.res(0) & 0xff).toBe(want);
    });
  }
});

describe("key_pressed", () => {
  it("M = semifila 7 bit 2", async () => {
    const r = await withKeys(["M"], [call("key_pressed", 7, 2), keep(0), call("key_pressed", 7, 1), keep(1), call("key_pressed", 0, 0), keep(2)].join("\n"));
    expect([r.res(0) & 0xff, r.res(1) & 0xff, r.res(2) & 0xff]).toEqual([1, 0, 0]);
  });
  it("CAPS = semifila 0 bit 0; ENTER = semifila 6 bit 0", async () => {
    const r = await withKeys(["CAPS", "ENTER"], [call("key_pressed", 0, 0), keep(0), call("key_pressed", 6, 0), keep(1), call("key_pressed", 6, 1), keep(2)].join("\n"));
    expect([r.res(0) & 0xff, r.res(1) & 0xff, r.res(2) & 0xff]).toEqual([1, 1, 0]);
  });
});

describe("wait_key", () => {
  it("espera a que se suelte la tecla anterior y devuelve la siguiente", async () => {
    const r = await run(program(call("wait_key") + "\n" + keep(0)), { run: false });
    hold(r.p, ["K"], true);    // pulsada desde el principio: no cuenta
    r.frames(3);
    expect(r.atFin()).toBe(false);
    hold(r.p, ["K"], false);
    r.frames(3);
    expect(r.atFin()).toBe(false);
    hold(r.p, ["CAPS", "J"], true);
    r.untilFin(5);
    expect(r.res(0) & 0xff).toBe("J".charCodeAt(0));
  });
});

describe("joysticks (formato Kempston: R 1, L 2, D 4, U 8, F 16)", () => {
  const cases: [string, string[], number][] = [
    ["joy_qaop", ["Q", "P", "SPACE"], 8 + 1 + 16],
    ["joy_qaop", ["A", "O"], 4 + 2],
    ["joy_sinclair1", ["6", "9"], 2 + 8],
    ["joy_sinclair1", ["7", "8", "0"], 1 + 4 + 16],
    ["joy_sinclair2", ["2", "3"], 1 + 4],
    ["joy_sinclair2", ["1", "4", "5"], 2 + 8 + 16],
    ["joy_cursor", ["5", "8"], 2 + 1],
    ["joy_cursor", ["6", "7", "0"], 4 + 8 + 16],
    ["joy_cursor", [], 0],
  ];
  for (const [fn, keys, want] of cases) {
    it(`${fn} [${keys.join(",")}] → ${want}`, async () => {
      const r = await withKeys(keys, call(fn) + "\n" + keep(0));
      expect(r.res(0) & 0xff).toBe(want);
    });
  }
  it("joy_kempston sin interfaz (el núcleo no emula Kempston: el puerto 1Fh es bus flotante) → 0", async () => {
    const r = await withKeys(["Q"], ["        halt", call("joy_kempston"), keep(0)].join("\n"));
    expect(r.res(0) & 0xff).toBe(0);
  });
});
