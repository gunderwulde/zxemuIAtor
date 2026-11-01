// K1: el código C convive con la ROM 48K de verdad. Se compila, se ejecuta con
// assembleAndRun de I1 (vuelta al editor de BASIC por su trampolín) y se comprueba:
//  - RST 10h (PRINT-OUT de la ROM) desde una función C con marco IX e interrupciones
//    IM 1 activas (la INT llama a KEYBOARD con IY = 5C3Ah): IY intacto (docs/c-abi.md §3).
//  - El RET del crt0 vuelve a BASIC y BASIC sigue funcionando (PRINT 7*6 → 42, "0 OK").
// Oráculos: la propia ROM (texto por OCR con su fuente, informe "0 OK") y valores a mano.
import { describe, expect, it } from "vitest";
import { compile } from "../../web/src/cc";
import { Core } from "../../web/src/emu/core";
import { assembleAndRun } from "../../web/src/ui/run";
import { assemble } from "../../web/src/asm";
import { typeKeys } from "../util/keys";
import { screenLines } from "../util/screen";
import { instantiate, rom48 } from "../util/wasm";

async function booted(): Promise<Core> {
  const c = new Core(await instantiate("core"));
  c.loadRom(rom48());
  for (let i = 0; i < 150; i++) c.runFrame();
  return c;
}

const PROGRAM = `
/* Imprime con RST 10h: A = carácter. La ROM destruye AF, BC, DE, HL; IX e IY no. */
void putch(char c) __naked {
__asm
        ld hl,2
        add hl,sp
        ld a,(hl)
        rst 16
        ret
__endasm;
}
void print(const char *s) { while (*s) putch(*s++); }
void printnum(unsigned n) { char buf[6]; int i = 0; do { buf[i++] = '0' + n % 10; n /= 10; } while (n); while (i) putch(buf[--i]); }
int main(void) {
  int k;
__asm
        ld a,2
        call 1601h      ; CHAN-OPEN: canal S (pantalla superior)
__endasm;
  putch(22); putch(5); putch(3);          /* AT 5,3 */
  print("C en el Spectrum");
  putch(22); putch(7); putch(3);
  for (k = 0; k < 3; k++) { printnum(1000 + k * 111); putch(' '); }
  return 0;
}`;

describe("C con la ROM", () => {
  it("imprime con RST 10h, vuelve a BASIC y BASIC responde", async () => {
    const core = await booted();
    const cc = compile(new Map([["main.c", PROGRAM]]), { main: "main.c" });
    expect(cc.errors).toEqual([]);
    const r = assembleAndRun(core, cc.asm);
    expect(r.ok, JSON.stringify(r.messages)).toBe(true);
    for (let i = 0; i < 20; i++) core.runFrame();
    const t = screenLines(core.ram());
    expect(t[5]!.slice(3, 19)).toBe("C en el Spectrum");
    expect(t[7]!.slice(3, 18)).toBe("1000 1111 1222 ");
    expect(core.regs.get16("iy")).toBe(0x5c3a);
    typeKeys(core, "PRINT 7*6\n");
    for (let i = 0; i < 10; i++) core.runFrame();
    const t2 = screenLines(core.ram());
    expect(t2.some((l) => /\b42\b/.test(l)), t2.join("\n")).toBe(true);
    expect(t2[22]! + t2[23]!).toContain("0 OK");
  });

  it("cLineMap: la dirección de cada línea C mapeada es una instrucción, en orden creciente dentro de main", () => {
    const cc = compile(new Map([["main.c", PROGRAM]]), { main: "main.c" });
    const asm = assemble(cc.asm);
    const lines = cc.asm.split("\n");
    // Cada entrada apunta a su comentario "; main.c:N: …" en el ensamblador generado.
    for (const m of cc.cLineMap) expect(lines[m.asmLine - 1]).toMatch(new RegExp(`^; ${m.file}:${m.line}: `));
    // PC → línea C: la primera instrucción tras la marca.
    const addrOf = (asmLine: number) => asm.lineMap.find((l) => l.line > asmLine)!.addr;
    const srcLines = PROGRAM.split("\n");
    const lineOf = (needle: string) => srcLines.findIndex((l) => l.includes(needle)) + 1;
    const main = asm.symbols.get("_main")!;
    const entry = (needle: string) => cc.cLineMap.find((m) => m.line === lineOf(needle))!;
    expect(addrOf(entry("int main(void)").asmLine)).toBe(main);
    expect(addrOf(entry("void print(").asmLine)).toBe(asm.symbols.get("_print"));
    const order = ["ld a,2", "putch(22); putch(5)", "print(\"C en", "putch(22); putch(7)", "return 0"].map((n) => addrOf(entry(n).asmLine));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Las líneas de __asm se mapean una a una.
    expect(cc.cLineMap.some((m) => m.line === lineOf("call 1601h"))).toBe(true);
  });
});
