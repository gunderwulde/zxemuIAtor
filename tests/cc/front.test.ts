// K1: lexer, preprocesador, parser y tipos. Esperados escritos a mano (C99).
import { describe, expect, it } from "vitest";
import { lex } from "../../web/src/cc/lexer";
import { Preprocessor, type Diag } from "../../web/src/cc/preproc";
import { compile } from "../../web/src/cc";
import { parseFile, Program } from "../../web/src/cc/parser";
import { sizeOf, typeStr, type Expr, type Stmt } from "../../web/src/cc/types";

const toks = (s: string) => lex(s, "t.c", []).filter((t) => t.k !== "eof");

describe("lexer", () => {
  it("números: decimal, hex, octal, binario y sufijos", () => {
    const t = toks("0 10 0x1F 017 0b101 65535u 40000 0XFFu");
    expect(t.map((x) => x.n)).toEqual([0, 10, 31, 15, 5, 65535, 40000, 255]);
    expect(t.map((x) => !!x.uns)).toEqual([false, false, false, false, false, true, false, true]);
  });

  it("caracteres y cadenas con escapes; £ y © del juego del Spectrum", () => {
    const t = toks(`'A' '\\n' '\\x7f' '\\0' "a\\tb\\101\\\\" "£©"`);
    expect(t.slice(0, 4).map((x) => x.n)).toEqual([65, 10, 127, 0]);
    expect(t[4]!.bytes).toEqual([97, 9, 98, 65, 92]);
    expect(t[5]!.bytes).toEqual([0x60, 0x7f]);
  });

  it("puntuación de 3, 2 y 1 caracteres y posiciones 1-based", () => {
    const t = toks("a<<=b->c\n  ...x");
    expect(t.map((x) => x.v)).toEqual(["a", "<<=", "b", "->", "c", "...", "x"]);
    expect(t.map((x) => `${x.line}:${x.col}`)).toEqual(["1:1", "1:2", "1:5", "1:6", "1:8", "2:3", "2:6"]);
    expect(t.map((x) => x.bol)).toEqual([true, false, false, false, false, true, false]);
  });

  it("comentarios y continuación de línea", () => {
    const t = toks("a /* x\n y */ b // z\nc \\\nd");
    expect(t.map((x) => `${x.v}@${x.line}`)).toEqual(["a@1", "b@2", "c@3", "d@4"]);
    expect(t[3]!.bol).toBe(false); // la continuación une las líneas
  });

  it("__asm captura el texto crudo hasta __endasm", () => {
    const t = toks("x; __asm\n  ld a,1 ; hola\n  ret\n__endasm; y");
    expect(t.map((x) => x.k)).toEqual(["id", "punc", "asm", "punc", "id"]);
    expect(t[2]!.v).toBe("  ld a,1 ; hola\n  ret");
    expect(t[2]!.asmLine).toBe(2);
    expect(t[4]!.line).toBe(4);
  });

  it("errores: número mal formado, coma flotante, cadena sin cerrar", () => {
    const errs: { file: string; line: number; col: number; msg: string }[] = [];
    lex("int a = 1.5;\nx = 09;\ns = \"abc\n", "t.c", errs);
    expect(errs.map((e) => `${e.line}:${e.col}`)).toEqual(["1:9", "2:5", "3:5"]);
    expect(errs[0]!.msg).toContain("coma flotante");
  });
});

function pp(files: Record<string, string>, main = "m.c") {
  const diags: Diag[] = [];
  const p = new Preprocessor((n) => (n in files ? { name: n, text: files[n]! } : undefined), diags);
  const out = p.run(main, files[main]!);
  return { text: out.map((t) => t.v).join(" "), diags, out, p };
}

describe("preprocesador", () => {
  it("#define de objeto y de función, # y ##, reescaneo sin recursión", () => {
    const r = pp({ "m.c": "#define N 10\n#define SQ(x) ((x)*(x))\n#define STR(a) #a\n#define CAT(a,b) a##b\n#define R R+1\nSQ(N) STR(hola mundo) CAT(ab,12) R" });
    expect(r.text).toBe(`( ( 10 ) * ( 10 ) ) "hola mundo" ab12 R + 1`);
    expect(r.diags).toEqual([]);
  });

  it("los tokens expandidos llevan la posición de la invocación", () => {
    const r = pp({ "m.c": "#define X 1 + 2\n\n   X" });
    expect(r.out.map((t) => `${t.line}:${t.col}`)).toEqual(["3:4", "3:4", "3:4"]);
  });

  it("#if/#elif/#else/#endif con defined, aritmética y anidado", () => {
    const r = pp({ "m.c": "#define A 2\n#if A == 1\none\n#elif defined(A) && A * 3 == 6\ntwo\n#if 0\nno\n#else\nyes\n#endif\n#else\nthree\n#endif\n#ifndef B\nnob\n#endif\n#ifdef A\nhasA\n#endif" });
    expect(r.text).toBe("two yes nob hasA");
  });

  it("#include con guardas, #pragma once y #pragma link (sin duplicados)", () => {
    const r = pp({
      "m.c": `#include "a.h"\n#include "a.h"\n#include <b.h>\n#include <b.h>\nend`,
      "a.h": "#ifndef A_H\n#define A_H\naa\n#pragma link \"a.asm\"\n#endif",
      "b.h": "#pragma once\nbb\n#pragma link \"a.asm\"",
    });
    expect(r.text).toBe("aa bb end");
    expect(r.p.links.map((l) => l.name)).toEqual(["a.asm"]);
  });

  it("errores: include inexistente, #endif suelto, #error, argumentos de macro", () => {
    const r = pp({ "m.c": "#include \"no.h\"\n#endif\n#error para\n#define F(a,b) a\nF(1)\n#if 1\n" });
    expect(r.diags.map((d) => `${d.line}:${d.col} ${d.severity}`)).toEqual(["1:10 error", "2:2 error", "3:2 error", "5:1 error", "6:2 error"]);
    expect(r.diags[2]!.msg).toBe("#error para");
  });
});

function parse(src: string) {
  const diags: Diag[] = [];
  const prog = new Program();
  const toks = new Preprocessor(() => undefined, diags).run("t.c", src);
  toks.push({ k: "eof", v: "", file: "t.c", line: 999, col: 1, bol: true });
  parseFile(toks, 0, prog, diags);
  return { prog, diags };
}
const g = (src: string, name: string) => parse(src).prog.globals.find((v) => v.name === name)!;
/** Expresión de `return` de la función f. */
function retExpr(src: string, f = "f"): Expr {
  const fn = parse(src).prog.funcs.find((x) => x.name === f)!;
  const body = (fn.body as Extract<Stmt, { k: "block" }>).body;
  return (body[body.length - 1] as Extract<Stmt, { k: "return" }>).e!;
}

describe("tipos y declaraciones", () => {
  it("declaradores: punteros, arrays, arrays de punteros y punteros a array", () => {
    const src = "char *a[3]; int (*b)[4]; unsigned m[2][5]; const char *s; char *const t = 0; signed char sc; short sh; unsigned long_; struct P { char c; int i; char *p; } st;";
    expect(typeStr(g(src, "a").type)).toBe("char * [3]");
    expect(typeStr(g(src, "b").type)).toBe("int [4] *");
    expect(typeStr(g(src, "m").type)).toBe("unsigned int [5] [2]");
    expect(typeStr(g(src, "s").type)).toBe("const char *");
    expect(typeStr(g(src, "t").type)).toBe("char *const");
    expect(typeStr(g(src, "sc").type)).toBe("signed char");
    expect(typeStr(g(src, "sh").type)).toBe("int");
    expect([sizeOf(g(src, "a").type), sizeOf(g(src, "b").type), sizeOf(g(src, "m").type), sizeOf(g(src, "st").type)]).toEqual([6, 2, 20, 5]);
  });

  it("structs sin relleno con offsets en orden; typedef; enum", () => {
    const { prog } = parse("typedef struct S { char a; int b; char c[3]; struct S *n; } S; S x; enum E { A, B = 7, C }; int y = C;");
    const t = prog.globals.find((v) => v.name === "x")!.type;
    expect(t.k).toBe("struct");
    if (t.k !== "struct") return;
    expect(t.s.fields.map((f) => `${f.name}@${f.off}`)).toEqual(["a@0", "b@1", "c@3", "n@6"]);
    expect(t.s.size).toBe(8);
    const y = prog.globals.find((v) => v.name === "y")!;
    expect(y.init!.items[0]!.e).toMatchObject({ k: "num", v: 8 });
  });

  it("promociones: char + char es int; int + unsigned es unsigned; plegado de 16 bits", () => {
    expect(retExpr("char a, b; int f(void) { return a + b; }").t).toMatchObject({ k: "int", size: 2, signed: true });
    expect(retExpr("int a; unsigned b; int f(void) { return a + b; }")).toMatchObject({ k: "cast", e: { t: { signed: false } } });
    expect(retExpr("int f(void) { return 32767 + 1; }")).toMatchObject({ k: "num", v: -32768 });
    expect(retExpr("int f(void) { return 65535u + 2; }")).toMatchObject({ k: "num", v: 1 });
    expect(retExpr("int f(void) { return -7 / 2 * 10 + -7 % 2; }")).toMatchObject({ k: "num", v: -31 });
    expect(retExpr("int f(void) { return (unsigned char)300 + (signed char)200; }")).toMatchObject({ k: "num", v: 44 - 56 });
    expect(retExpr("int f(void) { return -1 < 0u; }")).toMatchObject({ k: "num", v: 0 });
    expect(retExpr("int f(void) { return sizeof(int[3][2]) + sizeof(char *); }")).toMatchObject({ k: "num", v: 14 });
  });

  it("aritmética de punteros escalada por el tamaño del apuntado", () => {
    const e = retExpr("int *p; int *f(void) { return p + 3; }");
    expect(e).toMatchObject({ k: "bin", op: "+", r: { k: "num", v: 6 } });
    const d = retExpr("struct T { char x[5]; } *p, *q; int f(void) { return p - q; }");
    expect(d).toMatchObject({ k: "bin", op: "/", r: { k: "num", v: 5 } });
  });
});

describe("errores con línea y columna", () => {
  it("#pragma org fija la dirección; opts.org tiene prioridad; un valor malo es un error", () => {
    const org = (src: string, o?: number) => /^\s+org (\d+)/m.exec(compile(new Map([["main.c", src]]), { main: "main.c", org: o }).asm)?.[1];
    const main = "int main(void) { return 0; }\n";
    expect(org("#pragma org 0xEA60\n" + main)).toBe("60000");
    expect(org("#pragma org 0xEA60\n" + main, 0x9000)).toBe("36864");
    expect(org(main)).toBe("32768");
    const bad = compile(new Map([["main.c", "#pragma org 70000\n" + main]]), { main: "main.c" });
    expect(bad.errors.map((e) => e.msg)).toEqual(["#pragma org espera una dirección 0..65535"]);
  });

  const errs = (src: string) => compile(new Map([["main.c", src]]), { main: "main.c" }).errors.filter((e) => e.severity === "error").map((e) => `${e.line}:${e.col}: ${e.msg}`);
  const warns = (src: string) => compile(new Map([["main.c", src]]), { main: "main.c" }).errors.filter((e) => e.severity === "warning").map((e) => `${e.line}:${e.col}: ${e.msg}`);

  it("identificador no declarado y función no declarada", () => {
    expect(errs("int main(void) {\n  int a;\n  a = b + 1;\n  foo(2);\n  return 0;\n}")).toEqual([
      "3:7: 'b' no está declarado",
      "4:3: función 'foo' no declarada (falta el #include o el prototipo)",
    ]);
  });

  it("falta ';' se señala al final de la línea anterior; el análisis continúa", () => {
    expect(errs("int main(void) {\n  int a = 1\n  a = 2;\n  return x;\n}")).toEqual([
      "2:12: se esperaba ';' y hay 'a'",
      "4:10: 'x' no está declarado",
    ]);
  });

  it("tipos: struct sin campo, asignar a array, número de argumentos, break fuera de bucle", () => {
    expect(errs("struct P { int x; } p;\nint f(int a, int b) { return a + b; }\nint arr[2];\nint main(void) {\n  p.y = 1;\n  arr = 0;\n  f(1);\n  break;\n  return 0;\n}")).toEqual([
      "5:5: struct 'P' no tiene el campo 'y'",
      "6:3: '=': no se puede asignar a un array",
      "7:3: 'f' espera 2 argumentos y recibe 1",
      "8:3: 'break' fuera de un bucle o switch",
    ]);
  });

  it("fuera del subconjunto: float, long, union, punteros a función, bitfields", () => {
    expect(errs("float f;\nlong l;\nunion U { int a; } u;\nint (*fp)(int);\nstruct B { int a : 3; } b;\nint main(void) { return 0; }")).toEqual([
      "1:1: 'float' no está soportado (no hay coma flotante)",
      "2:1: 'long' no está soportado (los enteros son de 16 bits)",
      "3:1: 'union' no está soportado",
      "4:7: los punteros a función no están soportados (v1)",
      "5:18: los campos de bits no están soportados",
    ]);
  });

  it("const, redeclaración, case repetido, goto a etiqueta inexistente, falta main", () => {
    expect(errs("const int k = 1;\nint k2;\nint k2(void);\nvoid g(int x) {\n  k = 2;\n  switch (x) { case 1: case 1: break; }\n  goto nowhere;\n}")).toEqual([
      "3:5: 'k2' ya está declarado como otra cosa",
      "5:3: '=': el objeto es const",
      "6:24: case 1 repetido",
      "7:8: etiqueta 'nowhere' usada pero no definida",
      "1:1: falta la función main",
    ]);
  });

  it("errores en ficheros incluidos llevan su nombre de fichero", () => {
    const r = compile(new Map([["main.c", `#include "h.h"\nint main(void) { return 0; }`], ["h.h", "int ok;\nint bad = ;\n"]]), { main: "main.c" });
    expect(r.errors.map((e) => `${e.file}:${e.line}:${e.col}`)).toEqual(["h.h:2:11"]);
  });

  it("avisos: conversión puntero/entero, división por cero, return sin valor", () => {
    expect(warns("int *p;\nint f(void) { return; }\nint main(void) {\n  int a = p;\n  p = 5;\n  a = a / 0;\n  return 0;\n}")).toEqual([
      "2:15: 'return' sin valor en una función que devuelve un valor",
      "4:11: inicialización: puntero convertido a entero sin cast",
      "5:7: asignación: entero convertido a puntero sin cast",
      "6:9: división por cero",
    ]);
  });

  it("función usada sin definir en C ni en ensamblador", () => {
    expect(errs("int ext(int);\nint main(void) { return ext(1); }")).toEqual(["1:5: función 'ext' declarada y usada pero no definida (ni en C ni en ensamblador)"]);
    // Si un __asm de fichero la define, no hay error.
    expect(errs("int ext(int);\n__asm\n_ext:\n  ret\n__endasm;\nint main(void) { return ext(1); }")).toEqual([]);
  });
});
