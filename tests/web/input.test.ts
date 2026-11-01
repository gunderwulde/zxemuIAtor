// W1: tabla de mapeo de teclas PC → matriz del Spectrum y recuento al soltar.
// Valores esperados: docs/zx48-hardware.md §6 (filas/bits) y la serigrafía del teclado
// del 48K (signos en rojo con SYMBOL SHIFT), escritos a mano aquí, no derivados de input.ts.
import { describe, expect, it } from "vitest";
import { KeyState, mapKey } from "../../web/src/emu/input";

// [fila, bit] según la tabla de §6.
const M: Record<string, [number, number]> = {
  CAPS: [0, 0], Z: [0, 1], X: [0, 2], C: [0, 3], V: [0, 4],
  A: [1, 0], S: [1, 1], D: [1, 2], F: [1, 3], G: [1, 4],
  Q: [2, 0], W: [2, 1], E: [2, 2], R: [2, 3], T: [2, 4],
  "1": [3, 0], "2": [3, 1], "3": [3, 2], "4": [3, 3], "5": [3, 4],
  "0": [4, 0], "9": [4, 1], "8": [4, 2], "7": [4, 3], "6": [4, 4],
  P: [5, 0], O: [5, 1], I: [5, 2], U: [5, 3], Y: [5, 4],
  ENTER: [6, 0], L: [6, 1], K: [6, 2], J: [6, 3], H: [6, 4],
  SPACE: [7, 0], SYM: [7, 1], M: [7, 2], N: [7, 3], B: [7, 4],
};
const idx = (name: string) => { const [r, b] = M[name]!; return r * 5 + b; };
const keysOf = (code: string, key: string) => {
  const m = mapKey(code, key);
  return m ? [...m.keys].sort((a, b) => a - b) : null;
};
const expectKeys = (code: string, key: string, names: string[]) =>
  expect(keysOf(code, key), `${code}/${key}`).toEqual(names.map(idx).sort((a, b) => a - b));

describe("mapKey: teclas base", () => {
  it("las 26 letras por código físico", () => {
    for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      expectKeys(`Key${c}`, c.toLowerCase(), [c]);
      expectKeys(`Key${c}`, c, [c]);           // con Shift: CAPS lo aporta la tecla Shift
    }
  });

  it("letras por código aunque la distribución diga otra cosa (AZERTY: KeyQ = 'a')", () => {
    expectKeys("KeyQ", "a", ["Q"]);
  });

  it("los 10 dígitos de la fila superior y del teclado numérico", () => {
    for (const d of "0123456789") {
      expectKeys(`Digit${d}`, d, [d]);
      expectKeys(`Numpad${d}`, d, [d]);
    }
  });

  it("Enter, Espacio y modificadores", () => {
    expectKeys("Enter", "Enter", ["ENTER"]);
    expectKeys("NumpadEnter", "Enter", ["ENTER"]);
    expectKeys("Space", " ", ["SPACE"]);
    expectKeys("ShiftLeft", "Shift", ["CAPS"]);
    expectKeys("ShiftRight", "Shift", ["CAPS"]);
    expectKeys("ControlLeft", "Control", ["SYM"]);
    expectKeys("ControlRight", "Control", ["SYM"]);
    expectKeys("AltRight", "AltGraph", ["SYM"]);
  });

  it("teclas que no son del Spectrum devuelven null", () => {
    for (const [code, key] of [["AltLeft", "Alt"], ["F5", "F5"], ["Tab", "Tab"], ["MetaLeft", "Meta"],
      ["CapsLock", "CapsLock"], ["BracketLeft", "["], ["Backslash", "\\"]]) {
      expect(mapKey(code!, key!), code).toBeNull();
    }
  });
});

describe("mapKey: combinaciones", () => {
  it("Backspace = CAPS+0 (DELETE), Escape = CAPS+SPACE (BREAK)", () => {
    expectKeys("Backspace", "Backspace", ["CAPS", "0"]);
    expectKeys("Escape", "Escape", ["CAPS", "SPACE"]);
  });

  it("cursores = CAPS+5/6/7/8", () => {
    expectKeys("ArrowLeft", "ArrowLeft", ["CAPS", "5"]);
    expectKeys("ArrowDown", "ArrowDown", ["CAPS", "6"]);
    expectKeys("ArrowUp", "ArrowUp", ["CAPS", "7"]);
    expectKeys("ArrowRight", "ArrowRight", ["CAPS", "8"]);
  });

  // Serigrafía roja del 48K.
  const SIGNS: [string, string][] = [
    ["!", "1"], ["@", "2"], ["#", "3"], ["$", "4"], ["%", "5"],
    ["&", "6"], ["'", "7"], ["(", "8"], [")", "9"], ["_", "0"],
    ["<", "R"], [">", "T"], ['"', "P"], [";", "O"],
    ["^", "H"], ["-", "J"], ["+", "K"], ["=", "L"],
    [":", "Z"], ["£", "X"], ["?", "C"], ["/", "V"],
    ["*", "B"], [",", "N"], [".", "M"],
  ];

  it("signos vía SYMBOL SHIFT según el teclado del 48K", () => {
    for (const [ch, base] of SIGNS) expectKeys("Whatever", ch, ["SYM", base]);
  });

  it("los signos se toman de .key, sea cual sea la tecla física", () => {
    expectKeys("Digit1", "!", ["SYM", "1"]);       // ANSI: Shift+1
    expectKeys("Digit7", "/", ["SYM", "V"]);       // ES: Shift+7
    expectKeys("Digit2", '"', ["SYM", "P"]);       // ES: Shift+2
    expectKeys("Period", ":", ["SYM", "Z"]);       // ES: Shift+.
    expectKeys("Minus", "_", ["SYM", "0"]);        // ANSI: Shift+-
    expectKeys("Comma", ",", ["SYM", "N"]);
    expectKeys("NumpadAdd", "+", ["SYM", "K"]);
    expectKeys("NumpadMultiply", "*", ["SYM", "B"]);
    expectKeys("Digit1", "&", ["SYM", "6"]);       // AZERTY sin Shift
    expectKeys("Digit1", "1", ["1"]);              // AZERTY con Shift
    expectKeys("Digit2", "é", ["2"]);              // carácter sin equivalente: tecla física
  });

  it("los signos y dígitos por .key enmascaran el Shift del PC; letras y especiales no", () => {
    expect(mapKey("Digit1", "!")!.char).toBe(true);
    expect(mapKey("Digit1", "1")!.char).toBe(true);
    expect(mapKey("KeyA", "A")!.char).toBeFalsy();
    expect(mapKey("Backspace", "Backspace")!.char).toBeFalsy();
  });
});

/** Matriz tal como la ve el núcleo, a partir de las llamadas a zx_key. */
function harness() {
  const down = new Set<string>();
  const calls: string[] = [];
  const ks = new KeyState((row, bit, d) => {
    const name = Object.keys(M).find((n) => M[n]![0] === row && M[n]![1] === bit)!;
    calls.push(`${name}${d ? "↓" : "↑"}`);
    if (d) down.add(name); else down.delete(name);
  });
  const state = () => [...down].sort();
  return { ks, state, calls };
}

describe("KeyState: recuento al soltar", () => {
  it("una letra: pulsar y soltar", () => {
    const { ks, state, calls } = harness();
    expect(ks.down("KeyA", "a")).toBe(true);
    expect(state()).toEqual(["A"]);
    expect(ks.up("KeyA")).toBe(true);
    expect(state()).toEqual([]);
    expect(calls).toEqual(["A↓", "A↑"]);
  });

  it("teclas ajenas no se tragan (no preventDefault)", () => {
    const { ks, calls } = harness();
    expect(ks.down("F5", "F5")).toBe(false);
    expect(ks.up("F5")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("autorrepetición: no reenvía ni duplica el recuento", () => {
    const { ks, state, calls } = harness();
    ks.down("KeyQ", "q");
    expect(ks.down("KeyQ", "q")).toBe(true);
    ks.down("KeyQ", "q");
    ks.up("KeyQ");
    expect(state()).toEqual([]);
    expect(calls).toEqual(["Q↓", "Q↑"]);
  });

  it("Shift + Backspace: soltar Backspace no suelta el CAPS de Shift", () => {
    const { ks, state } = harness();
    ks.down("ShiftLeft", "Shift");
    ks.down("Backspace", "Backspace");
    expect(state()).toEqual(["0", "CAPS"]);
    ks.up("Backspace");
    expect(state()).toEqual(["CAPS"]);
    ks.up("ShiftLeft");
    expect(state()).toEqual([]);
  });

  it("dos cursores a la vez comparten CAPS", () => {
    const { ks, state } = harness();
    ks.down("ArrowLeft", "ArrowLeft");
    ks.down("ArrowUp", "ArrowUp");
    expect(state()).toEqual(["5", "7", "CAPS"]);
    ks.up("ArrowLeft");
    expect(state()).toEqual(["7", "CAPS"]);
    ks.up("ArrowUp");
    expect(state()).toEqual([]);
  });

  it("Ctrl + signo: soltar el signo no suelta el SYM de Ctrl", () => {
    const { ks, state } = harness();
    ks.down("ControlLeft", "Control");
    ks.down("Comma", ",");
    expect(state()).toEqual(["N", "SYM"]);
    ks.up("Comma");
    expect(state()).toEqual(["SYM"]);
    ks.up("ControlLeft");
    expect(state()).toEqual([]);
  });

  it("Shift+1 = '!': el Spectrum ve SYM+1 sin CAPS; al soltar el 1 vuelve CAPS", () => {
    const { ks, state } = harness();
    ks.down("ShiftLeft", "Shift");
    expect(state()).toEqual(["CAPS"]);
    ks.down("Digit1", "!");
    expect(state()).toEqual(["1", "SYM"]);
    ks.up("Digit1");
    expect(state()).toEqual(["CAPS"]);
    ks.up("ShiftLeft");
    expect(state()).toEqual([]);
  });

  it("soltar Shift antes que la tecla del signo suelta la combinación original", () => {
    const { ks, state } = harness();
    ks.down("ShiftLeft", "Shift");
    ks.down("Digit1", "!");
    ks.up("ShiftLeft");
    expect(state()).toEqual(["1", "SYM"]);
    ks.up("Digit1");                           // .key sería "1" ahora: da igual
    expect(state()).toEqual([]);
  });

  it("Shift + letra = CAPS + letra (mayúscula)", () => {
    const { ks, state } = harness();
    ks.down("ShiftRight", "Shift");
    ks.down("KeyH", "H");
    expect(state()).toEqual(["CAPS", "H"]);
  });

  it("releaseAll (pérdida de foco) suelta todo", () => {
    const { ks, state } = harness();
    ks.down("ShiftLeft", "Shift");
    ks.down("ControlLeft", "Control");
    ks.down("KeyA", "a");
    ks.down("ArrowUp", "ArrowUp");
    ks.releaseAll();
    expect(state()).toEqual([]);
    expect(ks.up("KeyA")).toBe(false);         // ya no está retenida
    expect(state()).toEqual([]);
  });
});
