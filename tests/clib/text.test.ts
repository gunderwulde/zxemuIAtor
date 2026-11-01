// L1: texto (cls, at, putchar, print, printf), color y borde en el núcleo real.
// Oráculos: OCR con la fuente de la ROM (tests/util/screen.ts), atributos de docs §3
// (FLASH·128 + BRIGHT·64 + PAPER·8 + INK), BORDER de la ROM (2294h) para BORDCR, y
// cadenas esperadas escritas a mano según C99 (printf).
import { describe, expect, it } from "vitest";
import { screenLines } from "../util/screen";
import { call, keep, program, run } from "./harness";

const text = (ram: Uint8Array) => screenLines(ram);
const attrAt = (ram: Uint8Array, col: number, row: number) => ram[0x5800 + row * 32 + col]!;

describe("texto", () => {
  it("cls borra con el color actual y print escribe en at(col,row)", async () => {
    const r = await run(program([
      call("paper", 1), call("ink", 6), call("cls"),
      call("at", 3, 2), call("print", "s1"),
      call("ink", 2), call("print", "s2"),
    ].join("\n"), 's1: db "HOLA",0\ns2: db "!?",0'));
    const ram = r.ram();
    const t = text(ram);
    expect(t[2]!.slice(0, 10)).toBe("   HOLA!? ");
    expect(t[0]).toBe(" ".repeat(32));
    // Todo el fondo con PAPER 1 INK 6 = 0Eh (también las filas 22-23).
    for (let row = 0; row < 24; row++) for (let col = 0; col < 32; col++) {
      if (row === 2 && col >= 7 && col <= 8) expect(attrAt(ram, col, row)).toBe(0x0a); // INK 2
      else expect(attrAt(ram, col, row), `${col},${row}`).toBe(0x0e);
    }
  });

  it("putchar devuelve el carácter; '\\n' y 13 cambian de línea; la columna 32 sigue en la fila siguiente", async () => {
    const r = await run(program([
      call("cls"),
      call("putchar", "'A'"), keep(0),
      call("putchar", 10), call("putchar", "'B'"),
      call("putchar", 13), call("putchar", "'C'"),
      call("at", 30, 5), call("print", "s1"),
    ].join("\n"), 's1: db "0123",0'));
    const t = text(r.ram());
    expect(r.res(0)).toBe(65);
    expect(t[0]!.trimEnd()).toBe("A");
    expect(t[1]!.trimEnd()).toBe("B");
    expect(t[2]!.trimEnd()).toBe("C");
    expect(t[5]!.slice(30)).toBe("01");
    expect(t[6]!.slice(0, 3)).toBe("23 ");
  });

  it("nueva línea en la fila 23 sube la pantalla; escribir en (31,23) no la sube", async () => {
    const r = await run(program([
      call("cls"),
      call("at", 0, 0), call("print", "top"),
      call("at", 0, 23), call("print", "s1"),
      call("at", 31, 23), call("putchar", "'Z'"),
    ].join("\n"), 'top: db "ARRIBA",0\ns1: db "ABC\\nXYZ",0'));
    const t = text(r.ram());
    expect(t[0]!.trimEnd()).toBe("");      // ARRIBA ha subido fuera de la pantalla
    expect(t[22]!.trimEnd()).toBe("ABC");
    expect(t[23]).toBe("XYZ" + " ".repeat(28) + "Z");
  });

  it("los códigos 144..164 son los UDG (la ROM los inicializa con las letras A..U)", async () => {
    const r = await run(program([call("cls"), call("putchar", 144), call("putchar", 164), call("putchar", 200), call("putchar", 7)].join("\n")));
    expect(text(r.ram())[0]!.slice(0, 4)).toBe("AU??");
  });
});

describe("printf", () => {
  it("%d %u %x %X %s %c %%, anchura y ceros; devuelve los caracteres escritos", async () => {
    const r = await run(program([
      call("cls"),
      call("printf", "f1", -1234 & 0xffff, 65535, 0xbeef, 0xbeef, "sab", "'Z'"), keep(0),
      call("at", 0, 1),
      call("printf", "f2", 42, 7, -42 & 0xffff, 0x8000, 0, 255, "sab"), keep(1),
    ].join("\n"), [
      'f1: db "%d|%u|%x|%X|%s|%c|%%",0',
      'f2: db "%5d|%05u|%04d|%d|%x|%i|%4s.",0',
      'sab: db "ab",0',
    ].join("\n")));
    const t = text(r.ram());
    const l0 = "-1234|65535|beef|BEEF|ab|Z|%";
    const l1 = "   42|00007|-042|-32768|0|255|  ab.";
    expect(t[0]!.slice(0, l0.length)).toBe(l0);
    expect(t[1]!.slice(0, 32)).toBe(l1.slice(0, 32));
    expect(t[2]!.slice(0, l1.length - 32)).toBe(l1.slice(32));
    expect(r.res(0)).toBe(l0.length);
    expect(r.res(1)).toBe(l1.length);
  });
});

describe("color", () => {
  it("ink/paper/bright/flash/set_color componen el atributo", async () => {
    const r = await run(program([
      call("cls"),
      call("ink", 2), call("paper", 5), call("bright", 1), call("flash", 1), call("putchar", "'a'"),
      call("bright", 0), call("flash", 0), call("putchar", "'b'"),
      call("ink", 15), call("putchar", "'c'"),   // sólo cuentan los bits 0-2
      call("set_color", 0x47), call("putchar", "'d'"),
    ].join("\n")));
    const ram = r.ram();
    expect(attrAt(ram, 0, 0)).toBe(0x80 + 0x40 + 5 * 8 + 2);
    expect(attrAt(ram, 1, 0)).toBe(5 * 8 + 2);
    expect(attrAt(ram, 2, 0)).toBe(5 * 8 + 7);
    expect(attrAt(ram, 3, 0)).toBe(0x47);
  });

  it("border pinta el borde y deja BORDCR como BORDER de BASIC", async () => {
    const r = await run(program(call("border", 1)));
    expect(r.ram()[0x5c48]).toBe(0x0f);   // 1·8, tinta blanca (borde oscuro)
    r.frames(1);
    const fb = r.p.framebuffer();
    // Borde azul (docs §3: índice GRB, componente 0xD7): R = 0, G = 0, B = D7h.
    expect([fb[0], fb[1], fb[2]]).toEqual([0, 0, 0xd7]);
    const r2 = await run(program(call("border", 6)));
    expect(r2.ram()[0x5c48]).toBe(0x30);  // 6·8, tinta negra
  });
});
