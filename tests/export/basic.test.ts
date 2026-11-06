// Tokenizador BASIC. Esperados: los bytes del cargador "SHOOT" de la cinta original de
// Sootland (volcado de un bloque real de la ROM) y la forma de 5 bytes de la calculadora
// del 48K (manual del ZX Spectrum, cap. 24: 0.5 = 80 00 00 00 00, 1.5 = 81 40 …, PI = 82 49 0F DA A2).
import { describe, expect, it } from "vitest";
import { numberBytes, tokenizeBasic } from "../../web/src/export/basic";

const hex = (s: string) => s.split(" ").map((h) => parseInt(h, 16));

describe("numberBytes", () => {
  it("enteros pequeños: 00 signo lo hi 00", () => {
    expect(numberBytes(0)).toEqual([0, 0, 0, 0, 0]);
    expect(numberBytes(24999)).toEqual(hex("00 00 a7 61 00"));
    expect(numberBytes(60000)).toEqual(hex("00 00 60 ea 00"));
    expect(numberBytes(-1)).toEqual(hex("00 ff ff ff 00"));
  });
  it("fraccionarios: exponente +80h y mantisa de 32 bits con el signo en el primer bit", () => {
    expect(numberBytes(0.5)).toEqual(hex("80 00 00 00 00"));
    expect(numberBytes(1.5)).toEqual(hex("81 40 00 00 00"));
    expect(numberBytes(Math.PI)).toEqual(hex("82 49 0f da a2"));
    expect(numberBytes(-0.5)).toEqual(hex("80 80 00 00 00"));
    expect(numberBytes(100000)).toEqual(hex("91 43 50 00 00"));
  });
});

describe("tokenizeBasic", () => {
  it("el cargador de Sootland sale byte a byte igual que en la cinta (56 bytes)", () => {
    const src = '10 CLEAR 24999\n20 LOAD "loader.bin" CODE\n30 LET l=USR 60000\n';
    const want = hex(
      "00 0a 0d 00 fd 32 34 39 39 39 0e 00 00 a7 61 00 0d" +
      " 00 14 0f 00 ef 22 6c 6f 61 64 65 72 2e 62 69 6e 22 af 0d" +
      " 00 1e 10 00 f1 6c 3d c0 36 30 30 30 30 0e 00 00 60 ea 00 0d",
    );
    const r = tokenizeBasic(src);
    expect(r.errors).toEqual([]);
    expect(r.bytes).toEqual(want);
    expect(want.length).toBe(56);
  });
  it("las cadenas y REM se copian sin traducir; las cifras de un nombre no son números", () => {
    const r = tokenizeBasic('10 REM PRINT 1\n20 LET a1=2: PRINT "LOAD 3"');
    expect(r.errors).toEqual([]);
    // línea 10: REM y el resto crudo, sin 0Eh
    expect(r.bytes.slice(0, 4)).toEqual([0, 10, 10, 0]);
    expect(r.bytes.slice(4, 5)).toEqual([0xea]);
    expect(r.bytes.slice(5, 14)).toEqual([..." PRINT 1"].map((c) => c.charCodeAt(0)).concat(0x0d));
    const l20 = r.bytes.slice(4 + 10);
    expect(l20.slice(4)).toEqual([0xf1, 0x61, 0x31, 0x3d, 0x32, 0x0e, 0, 0, 2, 0, 0, 0x3a, 0xf5, 0x22, ...[..."LOAD 3"].map((c) => c.charCodeAt(0)), 0x22, 0x0d]);
  });
  it("operadores de dos caracteres, GOTO y diagnósticos", () => {
    expect(tokenizeBasic("10 IF a<=b THEN GOTO 20").bytes.slice(4)).toEqual(
      [0xfa, 0x61, 0xc7, 0x62, 0xcb, 0xec, 0x32, 0x30, 0x0e, 0, 0, 20, 0, 0, 0x0d],
    );
    expect(tokenizeBasic("PRINT 1").errors[0]!.msg).toContain("número");
    expect(tokenizeBasic("20 CLS\n10 CLS").errors[0]!.msg).toContain("orden");
    expect(tokenizeBasic("10000 CLS").errors[0]!.msg).toContain("fuera");
  });
});
