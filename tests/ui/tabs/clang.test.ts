// U1: resaltado de C (StreamLanguage propio). Tokens esperados escritos a mano.
import { describe, expect, it } from "vitest";
import { StringStream } from "@codemirror/language";
import { C_BUILTINS, C_LIB_CONSTS, cParser, type CState } from "../../../web/src/ui/tabs/clang";

/** Tokens no vacíos de varias líneas (estado compartido): [texto, estilo]. */
function tokens(src: string): [string, string | null][] {
  const st = cParser.startState!(4) as CState;
  const out: [string, string | null][] = [];
  for (const line of src.split("\n")) {
    if (line === "") { cParser.blankLine!(st, 4); continue; }
    const s = new StringStream(line, 4, 4);
    while (!s.eol()) {
      const style = cParser.token(s, st);
      if (s.current().trim()) out.push([s.current(), style]);
      s.start = s.pos;
    }
  }
  return out;
}

describe("resaltado C", () => {
  it("tipos, función, parámetros y llaves", () => {
    expect(tokens("int main(void) {")).toEqual([
      ["int", "typeName"], ["main", "variableName.function"], ["(", "bracket"], ["void", "typeName"],
      [")", "bracket"], ["{", "bracket"],
    ]);
  });

  it("palabras clave, operadores, números (dec, hex, sufijos) y comentario de línea", () => {
    expect(tokens("for (i = 0; i < 0x1Fu; i++) // bucle")).toEqual([
      ["for", "keyword"], ["(", "bracket"], ["i", "variableName"], ["=", "operator"], ["0", "number"],
      [";", "punctuation"], ["i", "variableName"], ["<", "operator"], ["0x1Fu", "number"], [";", "punctuation"],
      ["i", "variableName"], ["+", "operator"], ["+", "operator"], [")", "bracket"], ["// bucle", "comment"],
    ]);
  });

  it("número mal formado", () => {
    expect(tokens("x = 12ab;")[2]).toEqual(["12ab", "invalid"]);
  });

  it("funciones y constantes de la librería (sacadas de spectrum.h)", () => {
    expect(C_BUILTINS.has("border") && C_BUILTINS.has("printf") && C_BUILTINS.has("memcpy")).toBe(true);
    expect(C_LIB_CONSTS.has("YELLOW") && C_LIB_CONSTS.has("JOY_FIRE")).toBe(true);
    expect(C_LIB_CONSTS.has("SPECTRUM_H")).toBe(false); // guardas de cabecera fuera
    expect(tokens("border(YELLOW);")).toEqual([
      ["border", "variableName.standard"], ["(", "bracket"], ["YELLOW", "variableName.constant"],
      [")", "bracket"], [";", "punctuation"],
    ]);
  });

  it("cadenas con escapes y caracteres", () => {
    expect(tokens(`print("a\\"b\\n"); c = '\\'';`)).toEqual([
      ["print", "variableName.standard"], ["(", "bracket"], [`"a\\"b\\n"`, "string"], [")", "bracket"],
      [";", "punctuation"], ["c", "variableName"], ["=", "operator"], [`'\\''`, "character"], [";", "punctuation"],
    ]);
    expect(tokens(`s = "sin cerrar`)[2]).toEqual([`"sin cerrar`, "invalid"]);
  });

  it("preprocesador: directiva, <cabecera>, nombre de macro; acaba con la línea salvo '\\'", () => {
    expect(tokens("#include <spectrum.h>\nint x;")).toEqual([
      ["#include", "meta"], ["<spectrum.h>", "string"], ["int", "typeName"], ["x", "variableName"], [";", "punctuation"],
    ]);
    expect(tokens("  #define N 10 \\\n  + 2\nN")).toEqual([
      ["#define", "meta"], ["N", "macroName"], ["10", "number"], ["\\", "meta"],
      ["+", "operator"], ["2", "number"],
      ["N", "variableName"],
    ]);
    // "<" fuera de un #include es un operador.
    expect(tokens("a<b")[1]).toEqual(["<", "operator"]);
  });

  it("comentario /* */ de varias líneas", () => {
    expect(tokens("a /* uno\ndos */ b")).toEqual([
      ["a", "variableName"], ["/* uno", "comment"], ["dos */", "comment"], ["b", "variableName"],
    ]);
  });

  it("__asm … __endasm: el interior no es C", () => {
    expect(tokens("__asm\n  ld a,2 ; borde\n__endasm;")).toEqual([
      ["__asm", "keyword"], ["ld a,2 ", "string.special"], ["; borde", "comment"],
      ["__endasm", "keyword"], [";", "punctuation"],
    ]);
  });
});
