// I1: resaltado Z80 (tokens esperados escritos a mano) y diagnósticos del ensamblador.
import { describe, expect, it } from "vitest";
import { StringStream } from "@codemirror/language";
import { Text } from "@codemirror/state";
import { z80Parser } from "../../web/src/ui/editor/z80lang";
import { summary, toDiagnostics } from "../../web/src/ui/editor/diagnostics";
import { assemble } from "../../web/src/asm";

/** Tokens no vacíos de una línea: [texto, estilo]; los espacios se omiten. */
function tokens(line: string): [string, string | null][] {
  const st = z80Parser.startState!(8);
  const s = new StringStream(line, 8, 8);
  const out: [string, string | null][] = [];
  while (!s.eol()) {
    const style = z80Parser.token(s, st);
    if (s.current().trim()) out.push([s.current(), style]);
    s.start = s.pos;
  }
  return out;
}

describe("resaltado", () => {
  it("etiqueta, mnemónico, registros, número y comentario", () => {
    expect(tokens("start:  ld a,(ix+12h) ; carga")).toEqual([
      ["start:", "labelName"], ["ld", "keyword"], ["a", "typeName"], [",", "punctuation"],
      ["(", "paren"], ["ix", "typeName"], ["+", "operator"], ["12h", "number"], [")", "paren"],
      ["; carga", "comment"],
    ]);
  });

  it("todos los formatos de número", () => {
    for (const n of ["255", "#FF", "$FF", "0xFF", "0FFh", "%1010", "0b1010", "1010b", "17o", "17q", "99d"])
      expect(tokens(`  db ${n}`), n).toEqual([["db", "meta"], [n, "number"]]);
    expect(tokens("  db 12G")).toEqual([["db", "meta"], ["12G", "invalid"]]);
    expect(tokens("  jr $")).toEqual([["jr", "keyword"], ["$", "atom"]]);
    expect(tokens("  db 5%2")).toEqual([["db", "meta"], ["5", "number"], ["%", "operator"], ["2", "number"]]);
  });

  it("cadenas, af' y escapes", () => {
    expect(tokens(`  db "a\\"b",'it''s'`)).toEqual([
      ["db", "meta"], [`"a\\"b"`, "string"], [",", "punctuation"], ["'it''s'", "string"],
    ]);
    expect(tokens("  ex af,af'")).toEqual([["ex", "keyword"], ["af", "typeName"], [",", "punctuation"], ["af'", "typeName"]]);
    expect(tokens('  db "abc')).toEqual([["db", "meta"], ['"abc', "invalid"]]);
  });

  it("etiquetas sin ':' en columna 0 y con EQU sangrado; mnemónico en columna 0", () => {
    expect(tokens("loop djnz loop")).toEqual([["loop", "labelName"], ["djnz", "keyword"], ["loop", "variableName"]]);
    expect(tokens("   COLOR equ 4")).toEqual([["COLOR", "labelName"], ["equ", "meta"], ["4", "number"]]);
    expect(tokens("ret")).toEqual([["ret", "keyword"]]);
    expect(tokens(".next: inc hl")).toEqual([[".next:", "labelName"], ["inc", "keyword"], ["hl", "typeName"]]);
    expect(tokens("  .org 8000h")).toEqual([[".org", "meta"], ["8000h", "number"]]);
  });

  it("condiciones frente al registro C, y operadores con nombre", () => {
    expect(tokens("  jr c,fin")).toEqual([["jr", "keyword"], ["c", "atom"], [",", "punctuation"], ["fin", "variableName"]]);
    expect(tokens("  ret nz")).toEqual([["ret", "keyword"], ["nz", "atom"]]);
    expect(tokens("  ld c,a")).toEqual([["ld", "keyword"], ["c", "typeName"], [",", "punctuation"], ["a", "typeName"]]);
    expect(tokens("  ld a,HIGH x")).toEqual([["ld", "keyword"], ["a", "typeName"], [",", "punctuation"], ["HIGH", "operatorKeyword"], ["x", "variableName"]]);
    expect(tokens("  and 7")).toEqual([["and", "keyword"], ["7", "number"]]);
  });

  it("llamada a macro", () => {
    expect(tokens("  pausa 10")).toEqual([["pausa", "macroName"], ["10", "number"]]);
  });
});

describe("diagnósticos", () => {
  // Línea 3 con un registro inexistente; offsets calculados a mano:
  // "        org 8000h\n" = 18 caracteres, "        ld a,1\n" = 15 → la línea 3 empieza en 33.
  const src = "        org 8000h\n        ld a,1\n        ld q,2\n        ret\n";

  it("el error queda en la línea 3", () => {
    const doc = Text.of(src.split("\n"));
    const errs = assemble(src).errors;
    expect(errs.length).toBeGreaterThan(0);
    const d = toDiagnostics(doc, errs);
    for (const x of d) {
      expect(doc.lineAt(x.from).number).toBe(3);
      expect(x.from).toBeGreaterThanOrEqual(33);
      expect(x.to).toBeLessThanOrEqual(33 + "        ld q,2".length);
      expect(x.to).toBeGreaterThan(x.from);
      expect(x.severity).toBe("error");
    }
  });

  it("columna: el subrayado empieza donde dice el ensamblador y cubre el token", () => {
    const doc = Text.of(["  ld a,(hl)", "  jp nolabel"]);
    const d = toDiagnostics(doc, [{ line: 2, col: 6, msg: "símbolo indefinido", severity: "error" }]);
    // Línea 2 empieza en 12 ("  ld a,(hl)" = 11 + \n); col 6 → offset 17; "nolabel" = 7.
    expect(d).toEqual([{ from: 17, to: 24, severity: "error", message: "símbolo indefinido", source: "ensamblador" }]);
  });

  it("avisos y fuera de rango", () => {
    const doc = Text.of(["  db 300"]);
    const d = toDiagnostics(doc, [{ line: 9, col: 99, msg: "x", severity: "warning" }]);
    expect(d[0]!.severity).toBe("warning");
    expect(doc.lineAt(d[0]!.from).number).toBe(1);
    expect(summary([
      { line: 1, col: 1, msg: "", severity: "error" }, { line: 1, col: 1, msg: "", severity: "error" },
      { line: 1, col: 1, msg: "", severity: "warning" },
    ])).toBe("2 errores, 1 aviso");
  });
});
