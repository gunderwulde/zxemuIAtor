// Sintaxis, directivas, macros, condicionales, símbolos, salida y errores.
import { describe, expect, it } from "vitest";
import { assemble, type AsmResult } from "../../web/src/asm/index";

function asm(src: string, opts = {}): AsmResult {
  return assemble(src, opts);
}

/** Bytes del único segmento, exigiendo que no haya errores. */
function bytes(src: string, opts = {}): number[] {
  const r = asm(src, opts);
  const errs = r.errors.filter((e) => e.severity === "error");
  if (errs.length) throw new Error(errs.map((e) => `${e.line}:${e.col} ${e.msg}`).join("\n"));
  expect(r.segments.length).toBeLessThanOrEqual(1);
  return r.segments[0] ? [...r.segments[0].bytes] : [];
}

const errorsOf = (r: AsmResult) => r.errors.filter((e) => e.severity === "error");
const warningsOf = (r: AsmResult) => r.errors.filter((e) => e.severity === "warning");

describe("números y caracteres", () => {
  it("todas las bases", () => {
    expect(bytes(" db #FF,$FE,0xFD,0FCh,%1010,0b1011,1100b,99,'A',\"B\",17o,99d,0bh,0b1h")).toEqual([
      0xff, 0xfe, 0xfd, 0xfc, 10, 11, 12, 99, 65, 66, 15, 99, 0x0b, 0xb1,
    ]);
  });
  it("ceros a la izquierda son decimales (como M80)", () => {
    expect(bytes(" db 010, 0010")).toEqual([10, 10]);
  });
  it("carácter con escape y comilla doblada", () => {
    expect(bytes(" db '''', \"\\n\", \"\\x41\", '\\'")).toEqual([39, 10, 0x41, 92]);
  });
  it("constante de dos caracteres en DW", () => {
    expect(bytes(" dw 'AB'")).toEqual([0x42, 0x41]);
  });
});

describe("expresiones", () => {
  it("precedencia y operadores", () => {
    expect(bytes(`
 db 2+3*4, (2+3)*4, 1<<4|1, 7&3^1, ~0&0ffh, -1&0ffh, 17%5, 100/7, 20-4-3
 db high 1234h, low 1234h, HIGH(5678h), low(5678h)+1
 db !0, !5, 3>2, 2>3, 2==2, 2!=2, 5 ne 5, 5 eq 5, 4 ge 4, 3 lt 2, 2<>3, 2<=2
 db 1 && 0, 1 || 0, 16 shr 2, 1 shl 3, 7 mod 4, 6 and 3, 6 or 1, 6 xor 2
 db -(3), +4, 1+2<<1
`)).toEqual([
      14, 20, 17, 2, 255, 255, 2, 14, 13,
      0x12, 0x34, 0x56, 0x79,
      1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1,
      0, 1, 4, 8, 3, 2, 7, 4,
      0xfd, 4, 6,
    ]);
  });
  it("$ es la dirección de la sentencia", () => {
    expect(bytes(" org 4000h\n dw $, $+2\n jp $\n")).toEqual([0x00, 0x40, 0x02, 0x40, 0xc3, 0x04, 0x40]);
  });
  it("división por cero es un error con columna", () => {
    const r = asm(" org 0\n db 1/0\n");
    expect(errorsOf(r)).toMatchObject([{ line: 2, col: 6 }]);
  });
});

describe("etiquetas", () => {
  it("globales con y sin ':', locales asociadas a la última global", () => {
    const r = asm(`
 org 8000h
start:  nop
loop    djnz loop
.l1     jr .l1
other:
.l1     jr .l1
        jp loop.l1
  indented: nop
`);
    expect(errorsOf(r)).toEqual([]);
    expect(r.symbols.get("start")).toBe(0x8000);
    expect(r.symbols.get("loop")).toBe(0x8001);
    expect(r.symbols.get("loop.l1")).toBe(0x8003);
    expect(r.symbols.get("other.l1")).toBe(0x8005);
    expect(r.symbols.get("indented")).toBe(0x800a);
    expect([...r.segments[0]!.bytes]).toEqual([0x00, 0x10, 0xfe, 0x18, 0xfe, 0x18, 0xfe, 0xc3, 0x03, 0x80, 0x00]);
  });
  it("mnemónicos y registros sin distinguir mayúsculas; etiquetas sí", () => {
    const r = asm(" org 0\nAbc: LD A,(IX+1)\nabc: Ld b,C\n jp Abc\n");
    expect(errorsOf(r)).toEqual([]);
    expect(r.symbols.get("Abc")).toBe(0);
    expect(r.symbols.get("abc")).toBe(3);
  });
  it("EQU con referencia hacia delante, = y := redefinibles", () => {
    expect(bytes(`
 org 0
 ld a,K
K equ L+1
L equ fin-1
v = 1
 db v
v = v+1
 db v
w := 7
 db w
fin: db L, K
`)).toEqual([0x3e, 5, 1, 2, 7, 4, 5]);
  });
  it("símbolo duplicado e indefinido", () => {
    const r = asm(" org 0\na: nop\na: nop\n ld hl,nada\n");
    const e = errorsOf(r);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ line: 3, col: 1 });
    expect(e[0]!.msg).toMatch(/duplicado/);
    expect(e[1]).toMatchObject({ line: 4, col: 8 });
    expect(e[1]!.msg).toMatch(/nada/);
  });
});

describe("directivas de datos y posición", () => {
  it("DEFB/DB/BYTE, DEFW/DW/WORD, DEFM/DZ/DC", () => {
    expect(bytes(` org 0
 defb 1
 byte 2,3
 defw 1234h
 word 5,-1
 defm "Hi\\t", 'x'
 dz "ab"
 dc "OK"
`)).toEqual([1, 2, 3, 0x34, 0x12, 5, 0, 0xff, 0xff, 72, 105, 9, 120, 97, 98, 0, 79, 75 | 0x80]);
  });
  it("DEFS/DS/BLOCK con relleno, ALIGN", () => {
    expect(bytes(" org 0\n db 1\n ds 2\n defs 2,0aah\n block 1,'-'\n align 8\n db 2\n align 4,0ffh\n")).toEqual([
      1, 0, 0, 0xaa, 0xaa, 45, 0, 0, 2, 0xff, 0xff, 0xff,
    ]);
  });
  it("varios ORG → varios segmentos ordenados por dirección", () => {
    const r = asm(" org 9000h\n db 1,2\n org 8000h\n db 3\n");
    expect(r.segments.map((s) => [s.addr, [...s.bytes]])).toEqual([[0x8000, [3]], [0x9000, [1, 2]]]);
  });
  it("sobrescribir una zona avisa", () => {
    const r = asm(" org 8000h\n db 1,2\n org 8001h\n db 3\n");
    expect(warningsOf(r)).toHaveLength(1);
    expect([...r.segments[0]!.bytes]).toEqual([1, 3]);
  });
  it("desbordamiento de byte y palabra se avisa", () => {
    const r = asm(" org 0\n db 256, -129, 255, -128\n dw 65536, -32769, 65535\n ld a,300\n");
    const w = warningsOf(r);
    expect(w.map((x) => [x.line, x.col])).toEqual([[2, 5], [2, 10], [3, 5], [3, 12], [4, 7]]);
    expect(errorsOf(r)).toEqual([]);
  });
  it("sobrepasar FFFFh es un error", () => {
    expect(errorsOf(asm(" org 0fffeh\n db 1,2,3\n"))).toHaveLength(1);
  });
});

describe("entrada", () => {
  it("por defecto, la dirección del primer byte emitido", () => {
    expect(asm("x equ 5\n org 9000h\n nop\n").entry).toBe(0x9000);
  });
  it("END con dirección; lo que sigue a END se ignora", () => {
    const r = asm(" org 8000h\n nop\nmain: ret\n end main\n esto no es z80\n");
    expect(errorsOf(r)).toEqual([]);
    expect(r.entry).toBe(0x8001);
  });
  it("ENT", () => {
    expect(asm(" org 8000h\n nop\n ent\n ret\n").entry).toBe(0x8001);
    expect(asm(" org 8000h\n ent 1234h\n ret\n").entry).toBe(0x1234);
  });
  it("sin ORG se usa opts.org (0x8000 por defecto)", () => {
    expect(asm(" nop").segments[0]!.addr).toBe(0x8000);
    expect(asm(" nop", { org: 0x6000 }).segments[0]!.addr).toBe(0x6000);
  });
});

describe("macros", () => {
  it("parámetros, dos estilos de definición", () => {
    expect(bytes(`
 org 0
ldr: macro reg, val
 ld reg,val
 endm
 macro twice x
 db x,x
 endm
 ldr a, 5
 ldr hl, 1234h
 twice 7
`)).toEqual([0x3e, 5, 0x21, 0x34, 0x12, 7, 7]);
  });
  it("etiquetas locales '.x' sin colisión entre expansiones", () => {
    const r = asm(`
 org 0
wait macro
.l djnz .l
 endm
 wait
 wait
`);
    expect(errorsOf(r)).toEqual([]);
    expect([...r.segments[0]!.bytes]).toEqual([0x10, 0xfe, 0x10, 0xfe]);
  });
  it("LOCAL y concatenación '&' estilo M80, argumentos <a,b>", () => {
    expect(bytes(`
 org 0
m: macro ins, n
 local here
&here: db ins
 dw &here
 db n
 endm
 m <1,2>, 3
 m 4, 5
`)).toEqual([1, 2, 0, 0, 3, 4, 5, 0, 5]);
  });
  it("cadenas con comas como argumento", () => {
    expect(bytes(" org 0\nmsg macro s\n db s,0\n endm\n msg 'a,b'\n")).toEqual([97, 44, 98, 0]);
  });
  it("una etiqueta en la línea de llamada vale la dirección de la expansión", () => {
    const r = asm(" org 100h\nm macro\n nop\n endm\n nop\nhere: m\n");
    expect(r.symbols.get("here")).toBe(0x101);
  });
  it("errores dentro de la macro se atribuyen a la línea de la llamada", () => {
    const r = asm(" org 0\nbad macro\n ld q,1\n endm\n nop\n  bad\n");
    expect(errorsOf(r)).toHaveLength(1);
    expect(errorsOf(r)[0]).toMatchObject({ line: 6, col: 3 });
    expect(errorsOf(r)[0]!.msg).toMatch(/bad/);
  });
  it("MACRO sin ENDM", () => {
    expect(errorsOf(asm(" org 0\nm macro\n nop\n"))).toHaveLength(1);
  });
  it("REPT", () => {
    expect(bytes(" org 0\nn = 0\n rept 3\n db n\nn = n+1\n endr\n")).toEqual([0, 1, 2]);
  });
});

describe("condicionales", () => {
  it("IF/ELSE/ENDIF anidados, ELSEIF", () => {
    expect(bytes(`
 org 0
A equ 1
B equ 0
 if A
  db 1
  if B
   db 2
  else
   db 3
  endif
 else
  db 4
 endif
 if B
  db 5
 elseif A
  db 6
 else
  db 7
 endif
 IF 0
  esto no se ensambla ni se comprueba
 ENDIF
`)).toEqual([1, 3, 6]);
  });
  it("IFDEF/IFNDEF/IFIDN/IFDIF", () => {
    expect(bytes(" org 0\nX equ 1\n ifdef X\n db 1\n endif\n ifndef Y\n db 2\n endif\n ifidn a,a\n db 3\n endif\n ifdif a,b\n db 4\n endif\n")).toEqual([1, 2, 3, 4]);
  });
  it("una macro definida dentro de un IF falso no existe", () => {
    const r = asm(" org 0\n if 0\nm macro\n nop\n endm\n endif\n m\n");
    expect(errorsOf(r)).toHaveLength(1);
  });
  it("IF con símbolo definido más adelante es un error", () => {
    const r = asm(" org 0\n if later\n nop\n endif\nlater equ 1\n");
    expect(errorsOf(r)).toMatchObject([{ line: 2, col: 5 }]);
  });
  it("IF sin ENDIF y ENDIF sin IF", () => {
    expect(errorsOf(asm(" if 1\n nop\n"))).toHaveLength(1);
    expect(errorsOf(asm(" endif\n"))).toHaveLength(1);
  });
});

describe("INCLUDE", () => {
  it("usa el resolvedor y marca el fichero en lineMap y errores", () => {
    const files: Record<string, string> = { "lib.asm": "sub1: ret\n bad\n" };
    const r = asm(" org 8000h\n call sub1\n include \"lib.asm\"\n", { include: (p: string) => files[p] });
    expect(r.symbols.get("sub1")).toBe(0x8003);
    expect(r.lineMap).toContainEqual({ addr: 0x8003, line: 1, len: 1, file: "lib.asm" });
    expect(errorsOf(r)).toMatchObject([{ line: 2, file: "lib.asm" }]);
  });
});

describe("INCBIN", () => {
  const files: Record<string, Uint8Array> = { "g.bin": Uint8Array.from([1, 2, 3, 4, 5]) };
  const opts = { incbin: (p: string) => files[p] };
  const run = (src: string) => asm(src, opts);

  it("vuelca el fichero entero y avanza el PC", () => {
    const r = run(" org 8000h\n incbin \"g.bin\"\nend: nop\n");
    expect([...r.segments[0]!.bytes]).toEqual([1, 2, 3, 4, 5, 0]);
    expect(r.symbols.get("end")).toBe(0x8005);
  });

  it("admite desplazamiento y longitud (con expresiones)", () => {
    expect([...run(" org 8000h\n incbin \"g.bin\", 2\n").segments[0]!.bytes]).toEqual([3, 4, 5]);
    expect([...run("N equ 1\n org 8000h\n incbin \"g.bin\", N+1, 2\n").segments[0]!.bytes]).toEqual([3, 4]);
  });

  it("informa de fichero inexistente, rango inválido y falta de resolvedor", () => {
    expect(errorsOf(run(" incbin \"no.bin\"\n"))).toHaveLength(1);
    expect(errorsOf(run(" incbin \"g.bin\", 3, 9\n"))).toHaveLength(1);
    expect(errorsOf(run(" incbin \"g.bin\", -1\n"))).toHaveLength(1);
    expect(errorsOf(asm(" incbin \"g.bin\"\n"))).toHaveLength(1);
  });
});

describe("saltos relativos", () => {
  it("límites exactos de JR y DJNZ", () => {
    // Destino = dirección siguiente + e, con e en -128..127.
    expect(bytes(" org 8000h\n jr $+129\n")).toEqual([0x18, 0x7f]);
    expect(bytes(" org 8000h\n jr $-126\n")).toEqual([0x18, 0x80]);
    expect(bytes(" org 8000h\n djnz $+2\n")).toEqual([0x10, 0x00]);
  });
  it("fuera de rango: error con línea y columna del destino", () => {
    const r = asm(" org 8000h\n nop\n jr $+130\n djnz $-127\n jr nz,lejos\n ds 200\nlejos: nop\n");
    expect(errorsOf(r).map((e) => [e.line, e.col])).toEqual([[3, 5], [4, 7], [5, 8]]);
  });
  it("desplazamiento de (IX+d) fuera de rango", () => {
    const r = asm(" org 0\n ld a,(ix+128)\n ld (iy-129),1\n");
    expect(errorsOf(r)).toHaveLength(2);
  });
});

describe("errores", () => {
  it("varios errores en una pasada, con línea y columna, sin abortar", () => {
    const r = asm([
      " org 8000h",
      " ld a,b,c",      // 2: operandos no válidos (col del mnemónico)
      " foo 1",         // 3: desconocida
      " nop",
      "  ld a,(nada)",  // 5: símbolo indefinido en col 9
      " db 1+",         // 6: falta operando
      " db 'abc",       // 7: cadena sin cerrar
      " ret",
    ].join("\n"));
    const e = errorsOf(r);
    expect(e.map((x) => [x.line, x.col])).toEqual([[2, 2], [3, 2], [5, 9], [6, 7], [7, 5]]);
    // Las sentencias correctas se ensamblan igualmente.
    expect(r.segments[0]!.bytes.includes(0xc9)).toBe(true);
  });
  it("error de usuario con ERROR", () => {
    expect(errorsOf(asm(" error \"fallo\"\n"))[0]!.msg).toBe("fallo");
  });
});

describe("lineMap", () => {
  it("dirección, línea y longitud por sentencia que emite", () => {
    const r = asm(" org 8000h\nstart:\n ld a,1\n\n ld hl,4000h ; com\n db 1,2,3\nx equ 5\n");
    expect(r.lineMap).toEqual([
      { addr: 0x8000, line: 3, len: 2 },
      { addr: 0x8002, line: 5, len: 3 },
      { addr: 0x8005, line: 6, len: 3 },
    ]);
  });
  it("las expansiones de macro apuntan a la línea de la llamada", () => {
    const r = asm(" org 0\nm macro\n nop\n nop\n endm\n m\n");
    expect(r.lineMap).toEqual([{ addr: 0, line: 6, len: 1 }, { addr: 1, line: 6, len: 1 }]);
  });
});

describe("determinismo", () => {
  it("misma entrada, misma salida", () => {
    const src = " org 8000h\nm macro\n.l jr .l\n endm\n m\n m\n db 1\n";
    expect(JSON.stringify(asm(src), (_k, v) => (v instanceof Map ? [...v] : v instanceof Uint8Array ? [...v] : v)))
      .toBe(JSON.stringify(asm(src), (_k, v) => (v instanceof Map ? [...v] : v instanceof Uint8Array ? [...v] : v)));
  });
});

describe("compatibilidad sjasm (z80test)", () => {
  it("valores por defecto de parámetros, REPEAT con @#", () => {
    expect(bytes(" org 0\n macro m base,count,off:10\n repeat count\n db base+off+@#\n endrepeat\n endm\n m 1,3\n m 1,2,0\n")).toEqual([11, 12, 13, 1, 2]);
  });
  it("'&' tras un operando es AND, no concatenación", () => {
    expect(bytes(" org 0\n macro lo n\n db n&0ffh, (n>>8)&0ffh\n endm\n lo 1234h\n")).toEqual([0x34, 0x12]);
  });
  it("una macro recibe '.x' del llamador; '.@x' define en el ámbito exterior", () => {
    const r = asm(` org 0
 macro setp lab
 ld hl,lab
.@cnt := .@cnt+1
 endm
main:
.cnt := 0
 setp .buf
 setp .buf
.buf db .cnt
`);
    expect(errorsOf(r)).toEqual([]);
    expect([...r.segments[0]!.bytes]).toEqual([0x21, 6, 0, 0x21, 6, 0, 2]);
  });
});

describe("variantes de escritura", () => {
  it("directivas con punto, DEFL, 'x: equ', exa, mnemónico en columna 0", () => {
    expect(bytes("\t.org 100h\nk: equ 3\nn defl 4\n\t.db k,n\n exa\nld a,1\npage equ 9\n db page\n")).toEqual([3, 4, 0x08, 0x3e, 1, 9]);
  });
});

describe("REPT: errores", () => {
  it("se atribuyen a la línea del REPT", () => {
    const r = asm(" org 0\n nop\n rept 2\n ld q,1\n endr\n");
    expect(errorsOf(r).map((e) => [e.line, e.col])).toEqual([[3, 2], [3, 2]]);
  });
});
