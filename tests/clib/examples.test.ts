// L1: los 10 ejemplos C compilan sin errores ni avisos (K1 + librería) y hacen lo que
// dicen en el núcleo real. Oráculos: texto esperado escrito a mano desde la fuente
// (OCR con la fuente de la ROM), atributos de docs §3, matriz de teclado de docs §6,
// frecuencia = 3 500 000 / periodo (docs §1) y la secuencia de Hanoi resuelta a mano.
import { describe, expect, it } from "vitest";
import { TSTATES_PER_FRAME as F } from "../../web/src/emu/core";
import { C_EXAMPLES, DEFAULT_C_EXAMPLE } from "../../web/src/clib";
import { compileC, runC, type CRun } from "./charness";
import { pix } from "./harness";

const src = (id: string) => C_EXAMPLES.find((e) => e.id === id)!.source;

function inkedBox(ram: Uint8Array, y0 = 0, y1 = 192) {
  let minX = 999, maxX = -1, minY = 999, maxY = -1, n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < 256; x++) {
    if (ram[pix(x, y)]! & (0x80 >> (x & 7))) {
      n++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY, maxY, n };
}

/** Ejecuta frames recogiendo el log del beeper con T absoluto (ver sound.test.ts). */
function beeperFrames(r: CRun, frames: number): { t: number; level: number }[] {
  const p = r.p;
  const ev = new Map<number, number>();
  let frame = 0;
  for (let f = 0; f < frames; f++) {
    if (p.t >= F) frame++;
    p.x.zx_t_run_until(p.t >= F ? 2 * F : F);
    for (const e of p.beeperLog()) ev.set(frame * F + e.t, e.level);
  }
  p.runFrame(); // cierra el frame abierto
  return [...ev].sort((a, b) => a[0] - b[0]).map(([t, level]) => ({ t, level }));
}

describe("ejemplos C", () => {
  it("hay 10, de 1 a 10, y el de por defecto es el arco iris (visual)", () => {
    expect(C_EXAMPLES.map((e) => e.id)).toEqual(["hello", "table", "keys", "graphics", "rainbow", "scale", "sprite", "enemies", "hanoi", "game"]);
    C_EXAMPLES.forEach((e, i) => expect(e.title.startsWith(`${i + 1} · `)).toBe(true));
    expect(DEFAULT_C_EXAMPLE.id).toBe("rainbow");
  });

  for (const e of C_EXAMPLES) {
    it(`${e.id}: compila sin errores ni avisos y ensambla`, () => {
      const cc = compileC(e.source);
      expect(cc.errors).toEqual([]);
      expect(cc.asm.length).toBeGreaterThan(0);
    });
  }

  it("1 hola: texto y colores; una tecla vuelve a BASIC", async () => {
    const r = await runC(src("hello"));
    r.frames(10);
    const t = r.text();
    expect(t[4]!.slice(10, 22)).toBe("Hola, mundo!");
    expect(r.attr(10, 4)).toBe(0x46);              // BRIGHT, PAPER 0, INK 6
    for (let c = 1; c < 8; c++) {
      expect(t[7 + c]!.slice(6, 23)).toBe(`Tinta ${c}: Spectrum`);
      expect(r.attr(6, 7 + c)).toBe(c);
    }
    expect(t[20]!.slice(2, 29)).toBe("Pulsa una tecla para volver");
    expect(r.p.ram()[0x5c48]).toBe(0x0f);          // BORDER 1
    r.press(["X"], 3, 5);
    expect(r.back()).toBe(true);
    expect(r.text()[4]!.slice(10, 22)).toBe("Hola, mundo!");
  });

  it("2 tabla: filas de la tabla y la aritmética de 16 bits", async () => {
    const r = await runC(src("table"));
    r.frames(30);
    const t = r.text();
    expect(t[0]!.trimEnd()).toBe("    Tabla de multiplicar");
    expect(t[2]!.trimEnd()).toBe("  1  2  3  4  5  6  7  8  9");
    expect(t[6]!.trimEnd()).toBe("  5 10 15 20 25 30 35 40 45");
    expect(t[10]!.trimEnd()).toBe("  9 18 27 36 45 54 63 72 81");
    expect(t[12]!.trimEnd()).toBe("8! = 40320");
    expect(t[13]!.trimEnd()).toBe("-1000 / 7 = -142, resto -6");
    expect(t[14]!.trimEnd()).toBe("65535 + 1 = 0 (16 bits)");
    expect(t[15]!.trimEnd()).toBe("1000 en hex = 3e8");
    r.press(["SPACE"], 3, 5);
    expect(r.back()).toBe(true);
  });

  it("3 teclado: eco de la tecla, la estrella se mueve con P y O, ENTER sale", async () => {
    const r = await runC(src("keys"));
    r.frames(5);
    expect(r.text()[12]![15]).toBe("*");
    r.press(["P"], 24);
    let row = r.text()[12]!;
    const x = row.indexOf("*");
    expect(x).toBeGreaterThan(18);                 // ~6 celdas en 24 frames (1 cada 4)
    expect(x).toBeLessThan(23);
    expect(row.split("*").length).toBe(2);         // la vieja se ha borrado
    expect(r.text()[20]!.slice(0, 21)).toBe("Tecla: p  codigo: 112");
    r.press(["Q"], 9);
    expect(r.text()[12]!.includes("*")).toBe(false);
    expect(r.text()[10]![x]).toBe("*");            // Q sube: 2 celdas en 9 frames
    r.press(["CAPS", "G"], 2);
    expect(r.text()[20]!.slice(0, 21)).toBe("Tecla: G  codigo:  71");
    r.press(["ENTER"], 3, 3);
    expect(r.back()).toBe(true);
  });

  it("4 gráficos: marco, abanico y trama de puntos en verde brillante", async () => {
    const r = await runC(src("graphics"));
    r.frames(60);
    const ram = r.p.ram();
    const on = (x: number, y: number) => (ram[pix(x, y)]! & (0x80 >> (x & 7))) !== 0;
    for (const [x, y] of [[0, 0], [255, 0], [255, 175], [0, 175], [100, 0], [0, 100], [128, 88], [16, 0], [240, 175]] as const)
      expect(on(x, y), `${x},${y}`).toBe(true);
    for (const [x, y] of [[8, 8], [10, 8], [38, 38], [8, 38]] as const) expect(on(x, y)).toBe(true);
    expect(on(9, 9)).toBe(false);
    expect(on(39, 39)).toBe(false);
    expect(on(128, 180)).toBe(false);              // por debajo del marco no hay líneas
    expect(r.attr(5, 5)).toBe(0x44);
    expect(r.text()[22]!.trimEnd()).toBe("Pulsa una tecla");
    r.press(["SPACE"], 3, 5);
    expect(r.back()).toBe(true);
  });

  it("5 arco iris: bandas diagonales PAPER+BRIGHT que avanzan cada frame; ESPACIO restaura", async () => {
    const r = await runC(src("rainbow"));
    r.frames(5);
    const a0 = [...r.p.ram().slice(0x5800, 0x5800 + 22 * 32)];
    for (const v of a0) expect(v & 0xc7).toBe(0x40);
    const paperAt = (a: number[], col: number, row: number) => (a[row * 32 + col]! >> 3) & 7;
    // Banda de 4 celdas; la siguiente un color más; cada fila empieza un color después.
    expect(paperAt(a0, 1, 0)).toBe(paperAt(a0, 0, 0));
    expect(paperAt(a0, 3, 0)).toBe(paperAt(a0, 0, 0));
    expect(paperAt(a0, 4, 0)).toBe((paperAt(a0, 0, 0) + 1) & 7);
    expect(paperAt(a0, 0, 1)).toBe((paperAt(a0, 0, 0) + 1) & 7);
    expect(paperAt(a0, 0, 9)).toBe((paperAt(a0, 0, 0) + 1) & 7); // la fila 9 = la 1 (row & 7)
    r.frames(1);
    const a1 = [...r.p.ram().slice(0x5800, 0x5800 + 22 * 32)];
    expect(paperAt(a1, 0, 0)).toBe((paperAt(a0, 0, 0) + 1) & 7);
    // El borde es phase & 7: cambia de color de un frame a otro.
    const fb = r.p.framebuffer();
    const b0 = [fb[0], fb[1], fb[2]];
    r.frames(1);
    expect([fb[0], fb[1], fb[2]]).not.toEqual(b0);
    r.press(["SPACE"], 3, 10);
    expect(r.back()).toBe(true);
    expect([...r.p.ram().slice(0x5800, 0x5800 + 22 * 32)].every((v) => v === 0x38)).toBe(true);
    expect(r.p.ram()[0x5c48]).toBe(0x38);
  });

  it("6 escala: las 8 notas suenan 200 ms a su frecuencia (±1 %) y se escriben", async () => {
    const r = await runC(src("scale"));
    const log = beeperFrames(r, 110);
    const rises = log.filter((e) => e.level === 2).map((e) => e.t);
    const periods = rises.slice(1).map((t, i) => t - rises[i]!);
    for (const hz of [262, 294, 330, 349, 392, 440, 494, 523]) {
      const want = 3_500_000 / hz;
      const n = periods.filter((p) => Math.abs(p - want) / want < 0.01).length;
      // 200 ms = hz/5 periodos (menos el último de cada nota, que mide el hueco).
      expect(n, `${hz} Hz`).toBeGreaterThanOrEqual(Math.floor(hz / 5) - 2);
      expect(n, `${hz} Hz`).toBeLessThanOrEqual(Math.ceil(hz / 5));
    }
    const t = r.text();
    expect(t[0]!.trimEnd()).toBe("Escala de Do mayor");
    expect(t[2]!.trimEnd()).toBe("Do 262 Hz");
    expect(t[7]!.trimEnd()).toBe("La 440 Hz");
    expect(t[9]!.trimEnd()).toBe("Do 523 Hz");
    expect(t[11]!.trimEnd()).toBe("Fin");
    expect(r.back()).toBe(true);
  });

  it("7 sprite: P mueve la nave 2 píxeles por frame a la derecha sin dejar rastro; ENTER sale", async () => {
    const r = await runC(src("sprite"));
    r.frames(5);
    const b0 = inkedBox(r.p.ram(), 8);
    expect(b0).toEqual({ minX: 120, maxX: 135, minY: 88, maxY: 102, n: b0.n });
    r.press(["P"], 10, 2);
    const b1 = inkedBox(r.p.ram(), 8);
    const dx = b1.minX - b0.minX;
    expect(dx % 2).toBe(0);
    expect(dx).toBeGreaterThanOrEqual(16);
    expect(dx).toBeLessThanOrEqual(22);
    expect(b1.maxX - b1.minX).toBe(15);
    expect([b1.minY, b1.maxY, b1.n]).toEqual([88, 102, b0.n]); // XOR: no queda nada atrás
    r.press(["7"], 5, 2);                                        // cursor arriba
    const b2 = inkedBox(r.p.ram(), 8);
    expect(b2.minY).toBeLessThan(88);
    expect(b2.n).toBe(b0.n);
    r.press(["ENTER"], 3, 3);
    expect(r.back()).toBe(true);
  });

  it("8 enemigos: 6 'O' de colores 2..7 que se mueven y siguen siendo 6", async () => {
    const r = await runC(src("enemies"));
    r.frames(5);    // cls tarda ~2 frames (6912 bytes con LDIR)
    const find = () => {
      const out: string[] = [];
      r.text().forEach((l, y) => [...l].forEach((c, x) => { if (c === "O" && y >= 2) out.push(`${x},${y}`); }));
      return out;
    };
    const p0 = find();
    // Posiciones iniciales escritas a mano: x = 3 + 5i, y = 2 + 3i (puede que ya hayan dado un paso).
    expect(p0.length).toBe(6);
    expect(r.text()[0]!.trimEnd()).toBe("6 enemigos. Pulsa una tecla.");
    r.frames(30);
    const p1 = find();
    expect(p1.length).toBe(6);
    expect(p1).not.toEqual(p0);
    const inks = p1.map((s) => { const [x, y] = s.split(",").map(Number); return r.attr(x!, y!) & 7; }).sort();
    expect(inks).toEqual([2, 3, 4, 5, 6, 7]);
    r.press(["SPACE"], 3, 5);
    expect(r.back()).toBe(true);
  });

  it("9 Hanoi: los 15 movimientos de 4 discos en orden", async () => {
    const r = await runC(src("hanoi"));
    r.frames(20);
    const t = r.text().map((l) => l.trimEnd());
    // Resuelto a mano: hanoi(4,A,C,B).
    const moves = [
      [1, "A", "B"], [2, "A", "C"], [1, "B", "C"], [3, "A", "B"], [1, "C", "A"], [2, "C", "B"], [1, "A", "B"],
      [4, "A", "C"], [1, "B", "C"], [2, "B", "A"], [1, "C", "A"], [3, "B", "C"], [1, "A", "B"], [2, "A", "C"], [1, "B", "C"],
    ] as const;
    expect(t[0]).toBe("Torres de Hanoi (4 discos)");
    moves.forEach(([d, a, b], i) => expect(t[2 + i]).toBe(`${String(i + 1).padStart(2)}: disco ${d} ${a} -> ${b}`));
    expect(t[18]).toBe("15 movimientos (2x2x2x2 - 1)");
    r.press(["SPACE"], 3, 5);
    expect(r.back()).toBe(true);
  });

  it("10 juego: marcador, el jugador se mueve con O, caen objetos y acaba en GAME OVER", async () => {
    const r = await runC(src("game"));
    r.frames(5);
    expect(r.text()[0]).toMatch(/^ PUNTOS 00000 +VIDAS 3 *$/);
    expect(r.attr(0, 0)).toBe(0x0f);               // PAPER 1, INK 7
    expect(r.text()[21]![15]).toBe("A");
    r.press(["O"], 10);
    const px = r.text()[21]!.indexOf("A");
    expect(px).toBeGreaterThanOrEqual(9);
    expect(px).toBeLessThanOrEqual(11);            // 1 celda cada 2 frames
    // Caen objetos: alguno aparece y baja.
    let seen = false;
    for (let f = 0; f < 200 && !seen; f++) {
      r.frames(1);
      seen = r.text().slice(1, 21).some((l) => /[#$]/.test(l));
    }
    expect(seen).toBe(true);
    // Sin moverse, las rocas acaban quitando las 3 vidas (determinista en el emulador).
    let over = false;
    for (let f = 0; f < 40000 && !over; f += 50) {
      r.frames(50);
      over = r.text()[10]!.includes("GAME OVER");
    }
    expect(over).toBe(true);
    expect(r.text()[0]).toMatch(/^ PUNTOS \d{4}0 +VIDAS 0 *$/);
    expect(r.attr(11, 10) & 0x80).toBe(0x80);      // FLASH
    r.press(["SPACE"], 3, 5);
    expect(r.back()).toBe(true);
  });
});
