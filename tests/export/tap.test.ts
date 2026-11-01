// E1: estructura del .tap exportado. Los bytes esperados están escritos a mano a partir
// del formato documentado (WoS "TAP format", manual del 48K cap. 24, cabeceras de la ROM)
// y los tokens se leen de la tabla de palabras clave de rom/48.rom (0095h).
import { describe, expect, it } from "vitest";
import { exportSourceTap, stampedName } from "../../web/src/export";
import { TOKEN, basicNumber, buildTap, loaderBody } from "../../web/src/export/tap";
import { rom48 } from "../util/wasm";

const seg = (addr: number, bytes: number[]) => ({ addr, bytes: Uint8Array.from(bytes) });

describe("tokens BASIC", () => {
  it("coinciden con la tabla de palabras clave de la ROM", () => {
    // 0095h: palabras con el bit 7 en la última letra; la primera es "?" y la segunda
    // RND = A5h, así que la palabra i-ésima es el token A4h + i.
    const rom = rom48();
    const words: string[] = [];
    let w = "";
    for (let a = 0x95; words.length < 92; a++) {
      w += String.fromCharCode(rom[a]! & 0x7f);
      if (rom[a]! & 0x80) { words.push(w); w = ""; }
    }
    const tok = (s: string) => 0xa4 + words.indexOf(s);
    expect(words[1]).toBe("RND");
    expect(TOKEN.USR).toBe(tok("USR"));
    expect(TOKEN.CODE).toBe(tok("CODE"));
    expect(TOKEN.LOAD).toBe(tok("LOAD"));
    expect(TOKEN.RANDOMIZE).toBe(tok("RANDOMIZE"));
    expect(TOKEN.CLEAR).toBe(tok("CLEAR"));
  });
});

describe("números BASIC", () => {
  it("dígitos + 0Eh + entero pequeño de 5 bytes", () => {
    expect(basicNumber(0)).toEqual([0x30, 0x0e, 0, 0, 0, 0, 0]);
    expect(basicNumber(32767)).toEqual([0x33, 0x32, 0x37, 0x36, 0x37, 0x0e, 0, 0, 0xff, 0x7f, 0]);
    expect(basicNumber(65535)).toEqual([0x36, 0x35, 0x35, 0x33, 0x35, 0x0e, 0, 0, 0xff, 0xff, 0]);
    expect(() => basicNumber(65536)).toThrow();
    expect(() => basicNumber(-1)).toThrow();
  });

  it("cuerpo sin CLEAR y con dos LOAD \"\"CODE", () => {
    expect(loaderBody(null, 2, 16384)).toEqual([
      0xef, 0x22, 0x22, 0xaf, 0x3a,
      0xef, 0x22, 0x22, 0xaf, 0x3a,
      0xf9, 0xc0, 0x31, 0x36, 0x33, 0x38, 0x34, 0x0e, 0, 0, 0x00, 0x40, 0,
    ]);
  });
});

describe("buildTap", () => {
  it("un segmento: TAP completo byte a byte", () => {
    const r = buildTap([seg(0x8000, [0xc9])], 0x8000, "hello");
    expect(r.messages.filter((m) => m.severity !== "info")).toEqual([]);
    expect(r.clear).toBe(32767);
    // 10 CLEAR 32767: LOAD ""CODE : RANDOMIZE USR 32768
    const prog = [
      0x00, 0x0a, 0x20, 0x00,                                   // línea 10 (BE), 32 bytes (LE)
      0xfd, 0x33, 0x32, 0x37, 0x36, 0x37, 0x0e, 0, 0, 0xff, 0x7f, 0, 0x3a,
      0xef, 0x22, 0x22, 0xaf, 0x3a,
      0xf9, 0xc0, 0x33, 0x32, 0x37, 0x36, 0x38, 0x0e, 0, 0, 0x00, 0x80, 0,
      0x0d,
    ];
    expect(prog.length).toBe(36);
    const expected = [
      // cabecera Program: 19 bytes = flag + 17 + xor
      0x13, 0x00, 0x00,
      0x00, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x20, 0x20, 0x20, 0x20, // tipo 0, "hello     "
      0x24, 0x00, 0x0a, 0x00, 0x24, 0x00,                               // 36 bytes, LINE 10, prog 36
      0x48,                                                             // xor (a mano)
      0x26, 0x00, 0xff, ...prog, 0x53,
      // cabecera Bytes
      0x13, 0x00, 0x00,
      0x03, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x20, 0x20, 0x20, 0x20,
      0x01, 0x00, 0x00, 0x80, 0x00, 0x80,                               // 1 byte en 8000h, p2 32768
      0x40,
      0x03, 0x00, 0xff, 0xc9, 0x36,
    ];
    expect(Array.from(r.tap!)).toEqual(expected);
  });

  it("checksums: el XOR de flag+datos+checksum de cada bloque es 0", () => {
    const data = Array.from({ length: 1000 }, (_, i) => (i * 7 + 3) & 0xff);
    const r = buildTap([seg(0x4000, [1, 2, 3]), seg(0x9000, data)], 0x9000, "a very long name");
    const t = r.tap!;
    let n = 0;
    for (let p = 0; p < t.length; n++) {
      const len = t[p]! | (t[p + 1]! << 8);
      let x = 0;
      for (let i = 0; i < len; i++) x ^= t[p + 2 + i]!;
      expect(x).toBe(0);
      p += 2 + len;
      expect(p).toBeLessThanOrEqual(t.length);
    }
    expect(n).toBe(6);
    // nombre recortado a 10
    expect(String.fromCharCode(...t.subarray(4, 14))).toBe("a very lon");
  });

  it("varios segmentos: un bloque CODE por segmento, de mayor a menor dirección; CLEAR ignora la pantalla", () => {
    const r = buildTap([seg(0x4000, [0xaa]), seg(0x9000, [0xc9]), seg(0xc000, [1, 2])], 0x9000, "x");
    expect(r.clear).toBe(0x9000 - 1);
    const t = r.tap!;
    const headers: [number, number][] = [];
    for (let p = 0; p < t.length;) {
      const len = t[p]! | (t[p + 1]! << 8);
      if (t[p + 2] === 0 && t[p + 3] === 3) headers.push([t[p + 14]! | (t[p + 15]! << 8), t[p + 16]! | (t[p + 17]! << 8)]);
      p += 2 + len;
    }
    expect(headers).toEqual([[2, 0xc000], [1, 0x9000], [1, 0x4000]]);
  });

  it("sólo pantalla: sin CLEAR", () => {
    const r = buildTap([seg(0x4000, [0xc9])], 0x4000, "x");
    expect(r.clear).toBeNull();
    expect(Array.from(r.tap!.subarray(24, 24 + 4))).toEqual([0x00, 0x0a, 0x13, 0x00]); // 18 + ENTER
    expect(r.tap![28]).toBe(0xef);
  });

  it("errores: ROM, variables del sistema, área de BASIC, programa vacío", () => {
    const err = (r: ReturnType<typeof buildTap>) => r.messages.filter((m) => m.severity === "error").length;
    expect(buildTap([], 0x8000, "x").tap).toBeNull();
    let r = buildTap([seg(0x3ff0, [0])], 0x3ff0, "x");
    expect(r.tap).toBeNull(); expect(err(r)).toBe(1);
    r = buildTap([seg(0x5bf0, Array(32).fill(0))], 0x5bf0, "x");
    expect(r.tap).toBeNull(); expect(err(r)).toBe(1);
    r = buildTap([seg(0x5d00, [0xc9])], 0x5d00, "x");
    expect(r.tap).toBeNull(); expect(err(r)).toBe(1);
  });

  it("avisos: cerca del área de BASIC y entrada fuera del código", () => {
    const r = buildTap([seg(0x5da0, [0xc9])], 0x6000, "x");
    expect(r.tap).not.toBeNull();
    expect(r.messages.filter((m) => m.severity === "warning")).toHaveLength(2);
  });

  it("caracteres no ASCII del nombre → ?", () => {
    const r = buildTap([seg(0x8000, [0xc9])], 0x8000, "año");
    expect(String.fromCharCode(...r.tap!.subarray(4, 14))).toBe("a?o       ");
  });
});

describe("exportSourceTap y nombres", () => {
  it("con errores de ensamblado no hay TAP; sin errores, el mismo que buildTap", () => {
    const bad = exportSourceTap("  ld a,\n", "x");
    expect(bad.tap).toBeNull();
    expect(bad.messages.some((m) => m.severity === "error")).toBe(true);
    const ok = exportSourceTap("  org 8000h\n  ret\n", "hello");
    expect(Array.from(ok.tap!)).toEqual(Array.from(buildTap([seg(0x8000, [0xc9])], 0x8000, "hello").tap!));
  });

  it("stampedName con fecha local", () => {
    expect(stampedName("programa", "tap", new Date(2026, 0, 2, 3, 4, 5))).toBe("programa-20260102-030405.tap");
  });
});
