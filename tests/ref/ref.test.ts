// Autotests de los modelos REF y de las utilidades: comprueban que los modelos dicen lo
// que dicen las fuentes (docs, Fuse, ROM). No tocan el núcleo; deben pasar siempre.
import { describe, expect, it } from "vitest";
import { ioCycle, lineStart, memDelay, PATTERNS, runPattern } from "./contention";
import { attrAddr, bitmapAddr, bitmapXY, groupT, paletteRGB, renderFrame, SAMPLE_LAG } from "./video";
import { floatingBus, floatingSource } from "./floatingbus";
import { keyboardBits, readULA } from "./ula-ports";
import { rom48 } from "../util/wasm";
import { screenLines } from "../util/screen";
import { keyTables, textToStrokes } from "../util/keys";

describe("REF contención (DOC §4, §5)", () => {
  it("puntos fijos de TEST-PLAN ULA-01", () => {
    const fixed: Array<[number, number]> = [
      [14334, 0], [14335, 6], [14336, 5], [14340, 1], [14341, 0], [14342, 0], [14343, 6],
      [14462, 0], [14463, 0], [57119, 6], [57119 + 128, 0], [69887, 0],
    ];
    for (const [t, d] of fixed) expect(memDelay(t), `T ${t}`).toBe(d);
    expect(lineStart(191)).toBe(57119);
  });

  it("E/S: los cuatro casos de DOC §5 fuera de la ventana duran 4 T", () => {
    for (const port of [0x00fe, 0x40fe, 0x00ff, 0x40ff]) expect(ioCycle(1000, port, false).end).toBe(1004);
  });

  it("E/S en la ventana: N:1,C:3 frente a C:1,C:1,C:1,C:1", () => {
    const L = lineStart(10);
    // 0x00FE en L: N:1 (sin retardo) → T L+1 tiene retardo 5 → C:3 → L+1+5+3 = L+9
    expect(ioCycle(L, 0x00fe, false).end).toBe(L + 9);
    // 0x00FF: N:4 sin contención
    expect(ioCycle(L, 0x00ff, false).end).toBe(L + 4);
    // 0x40FE en L: C (6) +1 → L+7 (retardo de offset 7 = 0) +3 → L+10
    expect(ioCycle(L, 0x40fe, false).end).toBe(L + 10);
    // 0x40FF en L: C(6)+1=L+7; C(0)+1=L+8; C(offset 8 → 6)+1=L+15; C(offset 15 → 0)+1 = L+16
    expect(ioCycle(L, 0x40ff, false).end).toBe(L + 16);
  });

  it("INC (HL) en zona contendida suma contención en cada ciclo con HL en el bus", () => {
    const L = lineStart(0);
    // pc en 0x8000 (libre), HL = 0x4000. pc:4 → L+4 (offset 4: 2) hl:3 → L+9 (offset 9: 5)
    // hl:1 → L+15 (offset 15: 0) hl:3 → L+19
    expect(runPattern(L, PATTERNS.incHL(0x8000, 0x4000)).end).toBe(L + 4 + 2 + 3 + 5 + 1 + 0 + 3);
  });
});

describe("REF vídeo (DOC §3, §7)", () => {
  it("geometría y paleta", () => {
    expect(bitmapAddr(0, 0)).toBe(0x4000);
    expect(bitmapAddr(0, 1)).toBe(0x4100);
    expect(bitmapAddr(0, 8)).toBe(0x4020);
    expect(bitmapAddr(31, 191)).toBe(0x57ff);
    expect(attrAddr(31, 191)).toBe(0x5aff);
    for (let a = 0x4000; a < 0x5800; a++) {
      const { x, y } = bitmapXY(a);
      if (bitmapAddr(x, y) !== a) throw new Error(`bitmapXY(${a})`);
    }
    expect(paletteRGB(7)).toEqual([0xd7, 0xd7, 0xd7]);
    expect(paletteRGB(15)).toEqual([0xff, 0xff, 0xff]);
    expect(paletteRGB(8)).toEqual([0, 0, 0]);
    expect(paletteRGB(2)).toEqual([0xd7, 0, 0]);
    expect(paletteRGB(4)).toEqual([0, 0xd7, 0]);
    expect(paletteRGB(1)).toEqual([0, 0, 0xd7]);
  });

  it("el byte 16384 se dibuja en T 14336 (DOC §7)", () => {
    expect(groupT(6, 48)).toBe(14336);
    expect(groupT(0, 0)).toBe(14336 - 48 * 224 - 24);
    expect(groupT(43, 295)).toBeLessThan(69888);
  });

  it("OUT que termina en 14339–14342 cambia el borde en la columna del byte 16384 (DOC §7)", () => {
    // Ciclo de E/S de 4 T sin contención (puerto 0x00FE con N:1 fuera de ventana) que
    // termina en `end` ⇒ la ULA ve el dato en end − 3 (ioCycle.dataT). El grupo g =
    // 14336 (posición del byte 16384) toma el valor nuevo sii dataT ≤ g + 3 y el grupo
    // anterior (g − 4) no lo toma sii dataT > g − 4 + 3.
    const g = 14336;
    for (const end of [14339, 14340, 14341, 14342]) {
      const dataT = ioCycle(end - 4, 0x00fe, true).dataT!;
      expect(dataT).toBe(end - 3);
      expect(dataT <= g + SAMPLE_LAG && dataT > g - 4 + SAMPLE_LAG, `end ${end}`).toBe(true);
    }
    expect(14338 - 3 <= g - 4 + SAMPLE_LAG).toBe(true); // termina en 14338 → ya cambia el grupo anterior
    expect(14343 - 3 <= g + SAMPLE_LAG).toBe(false); // termina en 14343 → llega tarde a g
  });

  it("renderiza un píxel encendido en su sitio", () => {
    const mem = new Uint8Array(0x1b00);
    mem[0] = 0x80;
    mem[0x1800] = 0x07; // tinta blanca, papel negro
    const fb = renderFrame({ screen: mem, border: 1, flashInverted: false, events: [] });
    const px = (x: number, y: number) => [...fb.subarray((y * 352 + x) * 4, (y * 352 + x) * 4 + 4)];
    expect(px(48, 48)).toEqual([0xd7, 0xd7, 0xd7, 0xff]);
    expect(px(49, 48)).toEqual([0, 0, 0, 0xff]);
    expect(px(0, 0)).toEqual([0, 0, 0xd7, 0xff]);
  });
});

describe("REF bus flotante (DOC §8, Fuse spectrum_unattached_port)", () => {
  it("primer byte en T 14338 y patrón de 8 T", () => {
    expect(floatingSource(14337)).toBeNull();
    expect(floatingSource(14338)).toEqual({ addr: 0x4000, kind: "bitmap" });
    expect(floatingSource(14339)).toEqual({ addr: 0x5800, kind: "attr" });
    expect(floatingSource(14340)).toEqual({ addr: 0x4001, kind: "bitmap" });
    expect(floatingSource(14341)).toEqual({ addr: 0x5801, kind: "attr" });
    for (const t of [14342, 14343, 14344, 14345]) expect(floatingSource(t)).toBeNull();
    expect(floatingSource(14346)).toEqual({ addr: 0x4002, kind: "bitmap" });
    // último grupo de la línea 0: columnas 30/31
    expect(floatingSource(14338 + 120)).toEqual({ addr: 0x401e, kind: "bitmap" });
    expect(floatingSource(14338 + 123)).toEqual({ addr: 0x581f, kind: "attr" });
    expect(floatingSource(14338 + 126)).toBeNull();
    expect(floatingSource(14338 + 224)).toEqual({ addr: 0x4100, kind: "bitmap" });
    expect(floatingSource(14338 + 224 * 192)).toBeNull();
    const ram = new Uint8Array(65536).fill(0x11);
    expect(floatingBus(100, ram)).toBe(0xff);
    expect(floatingBus(14338, ram)).toBe(0x11);
  });
});

describe("REF puerto 0xFE (DOC §6)", () => {
  it("tecla aislada, AND de semifilas, ghosting, Issue 2/3", () => {
    expect(keyboardBits(0xfefe, [[0, 0]])).toBe(0x1e);
    expect(keyboardBits(0xfdfe, [[0, 0]])).toBe(0x1f);
    expect(keyboardBits(0x00fe, [[0, 0], [1, 3]])).toBe(0x16);
    // Ghosting: (2,0) (2,1) (5,0) pulsadas; seleccionar la semifila 5 → aparece (5,1).
    expect(keyboardBits(0xdffe, [[2, 0], [2, 1], [5, 0]])).toBe(0x1c);
    expect(readULA(0xfefe, [], 0x10, 3)).toBe(0xff);
    expect(readULA(0xfefe, [], 0x08, 3)).toBe(0xbf);
    expect(readULA(0xfefe, [], 0x08, 2)).toBe(0xff);
    expect(readULA(0xfefe, [], 0x00, 2)).toBe(0xbf);
  });
});

describe("utilidades (ROM)", () => {
  const rom = rom48();

  it("screenText reconoce el mensaje de copyright dibujado con la fuente de la ROM", () => {
    const ram = new Uint8Array(65536);
    ram.set(rom, 0);
    const msg = "© 1982 Sinclair Research Ltd";
    for (let i = 0; i < msg.length; i++) {
      const code = msg[i] === "©" ? 0x7f : msg.charCodeAt(i);
      for (let k = 0; k < 8; k++) ram[bitmapAddr(i, 23 * 8 + k)] = rom[0x3d00 + (code - 0x20) * 8 + k]!;
    }
    const lines = screenLines(ram);
    expect(lines).toHaveLength(24);
    expect(lines[23]).toBe(msg.padEnd(32, " "));
    expect(lines[0]).toBe(" ".repeat(32));
  });

  it("las tablas de teclas salen de la ROM y son las del teclado del 48K", () => {
    const t = keyTables(rom);
    expect(t.kMode.get("PRINT")).toBe("P");
    expect(t.kMode.get("LOAD")).toBe("J");
    expect(t.kMode.get("GO TO")).toBe("G");
    expect(t.kMode.get("RANDOMIZE")).toBe("T");
    expect(t.lTokens.get("THEN")!.strokes).toEqual([["SYM", "G"]]);
    expect(t.lTokens.get("CODE")!.strokes).toEqual([["CAPS", "SYM"], ["I"]]);
    expect(t.lTokens.get("BEEP")!.strokes).toEqual([["CAPS", "SYM"], ["SYM", "Z"]]);
    expect(t.chars.get("+")).toEqual(["SYM", "K"]);
    expect(t.chars.get('"')).toEqual(["SYM", "P"]);
    expect(textToStrokes('PRINT 2+2\n', t)).toEqual([["P"], ["2"], ["SYM", "K"], ["2"], ["ENTER"]]);
    expect(textToStrokes('LOAD ""\n', t)).toEqual([["J"], ["SYM", "P"], ["SYM", "P"], ["ENTER"]]);
    expect(textToStrokes("10 IF a THEN PRINT CODE \"A\"\n", t)).toEqual([
      ["1"], ["0"], ["U"], ["A"], ["SYM", "G"], ["P"], ["CAPS", "SYM"], ["I"], ["SYM", "P"], ["CAPS", "A"], ["SYM", "P"], ["ENTER"],
    ]);
  });
});
