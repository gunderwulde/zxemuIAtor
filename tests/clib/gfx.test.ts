// L1: direcciones de pantalla, plot/unplot/point, line y sprites en el núcleo real.
// Oráculo: docs/zx48-hardware.md §3 (fórmula del bitmap y atributos, en `pix` del
// arnés, independiente de la librería) y valores escritos a mano.
import { describe, expect, it } from "vitest";
import { call, IX_SENTINEL, keep, libSize, pix, program, run } from "./harness";

describe("librería", () => {
  it("ensambla sin errores ni avisos y ocupa menos de 3 KB", () => {
    const n = libSize();
    expect(n).toBeGreaterThan(500);
    expect(n).toBeLessThan(3072);
  });
});

describe("direcciones", () => {
  it("zx_pxaddr y zx_attraddr dan las direcciones de la tabla de docs §3", async () => {
    const pts: [number, number][] = [[0, 0], [255, 191], [8, 1], [100, 63], [7, 64], [200, 130], [17, 8]];
    const body = pts.map(([x, y], k) => call("zx_pxaddr", x, y) + "\n" + keep(k)).join("\n") + "\n" +
      call("zx_attraddr", 0, 0) + "\n" + keep(10) + "\n" +
      call("zx_attraddr", 31, 23) + "\n" + keep(11) + "\n" +
      call("zx_attraddr", 5, 9) + "\n" + keep(12);
    const r = await run(program(body));
    pts.forEach(([x, y], k) => expect(r.res(k), `${x},${y}`).toBe(pix(x, y)));
    // Escritos a mano: (0,0) → 4000h, (255,191) → 57FFh, (8,1) → 4101h.
    expect(r.res(0)).toBe(0x4000);
    expect(r.res(1)).toBe(0x57ff);
    expect(r.res(2)).toBe(0x4101);
    expect(r.res(10)).toBe(0x5800);
    expect(r.res(11)).toBe(0x5aff);
    expect(r.res(12)).toBe(0x5800 + 9 * 32 + 5);
    expect(r.peek16(r.sym("ix_out"))).toBe(IX_SENTINEL);
    expect(r.peek16(r.sym("iy_out"))).toBe(0x5c3a);
  });

  it("set_attr / attr", async () => {
    const r = await run(program([
      call("set_attr", 3, 4, 0x45), call("set_attr", 31, 23, 0xc2),
      call("attr", 3, 4), keep(0), call("attr", 31, 23), keep(1),
    ].join("\n")));
    expect(r.ram()[0x5800 + 4 * 32 + 3]).toBe(0x45);
    expect(r.ram()[0x5aff]).toBe(0xc2);
    expect(r.res(0) & 0xff).toBe(0x45);
    expect(r.res(1) & 0xff).toBe(0xc2);
  });
});

describe("píxeles", () => {
  it("plot(0,0) pone el bit 7 de 4000h; plot(255,191) el bit 0 de 57FFh; y ≥ 192 no escribe", async () => {
    const r = await run(program([call("plot", 0, 0), call("plot", 255, 191), call("plot", 9, 10), call("plot", 10, 192)].join("\n")));
    const ram = r.ram();
    expect(ram[0x4000]).toBe(0x80);
    expect(ram[0x57ff]).toBe(0x01);
    expect(ram[pix(9, 10)]).toBe(0x40);
    // Nada más en el bitmap (192 no envuelve a la fila 0 ni escribe atributos).
    let set = 0;
    for (let a = 0x4000; a < 0x5800; a++) if (ram[a]) set++;
    expect(set).toBe(3);
    expect(r.peek16(r.sym("ix_out"))).toBe(IX_SENTINEL);
  });

  it("unplot borra sólo ese bit y point lo lee", async () => {
    const r = await run(program([
      "        ld hl,4000h\n        ld (hl),0FFh",
      call("unplot", 3, 0),
      call("point", 3, 0), keep(0), call("point", 4, 0), keep(1), call("point", 4, 200), keep(2),
    ].join("\n")));
    expect(r.ram()[0x4000]).toBe(0xef);
    expect(r.res(0) & 0xff).toBe(0);
    expect(r.res(1) & 0xff).toBe(1);
    expect(r.res(2) & 0xff).toBe(0);
  });
});

/** Píxeles a tinta en el bitmap (lista "x,y"). */
function inked(ram: Uint8Array): Set<string> {
  const s = new Set<string>();
  for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) if (ram[pix(x, y)]! & (0x80 >> (x & 7))) s.add(`${x},${y}`);
  return s;
}

describe("line", () => {
  it("horizontal, vertical, diagonal y un punto", async () => {
    const r = await run(program([call("line", 10, 5, 14, 5), call("line", 20, 3, 20, 0), call("line", 30, 30, 27, 33), call("line", 50, 50, 50, 50)].join("\n")));
    const want = ["10,5", "11,5", "12,5", "13,5", "14,5", "20,0", "20,1", "20,2", "20,3", "30,30", "29,31", "28,32", "27,33", "50,50"];
    expect([...inked(r.ram())].sort()).toEqual(want.sort());
  });

  it("pendiente suave (0,0)-(6,2): Bresenham escrito a mano", async () => {
    // dx=6, dy=2, err=4: (0,0) e2=8>-2 → x1 err=2, 8<6 no; (1,0) e2=4 → x2 err=0, 4<6 → y1 err=6;
    // (2,1) e2=12 → x3 err=4; (3,1) e2=8 → x4 err=2; (4,1) e2=4 → x5 err=0, y2 err=6; (5,2) → x6.
    const r = await run(program(call("line", 0, 0, 6, 2)));
    expect([...inked(r.ram())].sort()).toEqual(["0,0", "1,0", "2,1", "3,1", "4,1", "5,2", "6,2"].sort());
  });

  it("la línea más larga (0,191)-(255,0): 256 píxeles, uno por columna, extremos incluidos", async () => {
    const r = await run(program(call("line", 0, 191, 255, 0)));
    const s = inked(r.ram());
    expect(s.size).toBe(256);
    expect(s.has("0,191")).toBe(true);
    expect(s.has("255,0")).toBe(true);
    for (let x = 0; x < 256; x++) expect([...s].filter((p) => p.startsWith(`${x},`)).length).toBe(1);
  });
});

describe("sprites", () => {
  const data = [
    "g8:     db 0FFh,81h,81h,81h,81h,81h,81h,0FFh",
    "m8:     db 00h,00h,00h,00h,00h,00h,00h,00h",
    "g16:    ds 32,0AAh",
    "g16b:   db 0F0h,0Fh",
    "        ds 30,0",
    "mk16:   db 0FFh,00h",
    "        ds 30,0FFh",
  ].join("\n");

  it("sprite8 XOR alineado: 8 bytes en la columna; otro XOR lo borra", async () => {
    const r = await run(program([call("sprite8", 16, 8, "g8", 0)].join("\n"), data));
    const want = [0xff, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0xff];
    for (let k = 0; k < 8; k++) {
      expect(r.ram()[pix(16, 8 + k)], `fila ${k}`).toBe(want[k]);
      expect(r.ram()[pix(24, 8 + k)]).toBe(0);
    }
    const r2 = await run(program([call("sprite8", 16, 8, "g8", 0), call("sprite8", 16, 8, "g8", 0)].join("\n"), data));
    expect(inked(r2.ram()).size).toBe(0);
  });

  it("sprite8 desplazado 3 píxeles en dos bytes, y en x = 252 se recorta a la derecha", async () => {
    const r = await run(program([call("sprite8", 3, 0, "g8", 1), call("sprite8", 252, 100, "g8", 1)].join("\n"), data));
    // FFh >> 3 = 1Fh | E0h; 81h >> 3 = 10h | 20h.
    expect(r.ram()[pix(0, 0)]).toBe(0x1f);
    expect(r.ram()[pix(8, 0)]).toBe(0xe0);
    expect(r.ram()[pix(0, 1)]).toBe(0x10);
    expect(r.ram()[pix(8, 1)]).toBe(0x20);
    expect(r.ram()[pix(16, 0)]).toBe(0);
    // x = 252: columna 31, desplazamiento 4: FFh → 0Fh; lo que sobra no pasa a la fila siguiente.
    expect(r.ram()[pix(248, 100)]).toBe(0x0f);
    expect(r.ram()[pix(248, 101)]).toBe(0x08);
    expect(r.ram()[pix(0, 100)]).toBe(0);
    expect(r.ram()[pix(0, 101)]).toBe(0);
  });

  it("OR conserva el fondo; la máscara lo recorta", async () => {
    const r = await run(program([
      "        ld hl,4000h\n        ld (hl),0FFh\n        inc hl\n        ld (hl),0FFh",
      // Máscara 0 en las 8 filas: borra el fondo y pone el sprite (fila 0: FFh).
      call("sprite8_mask", 0, 0, "g8", "m8"),
      "        ld hl,4020h\n        ld (hl),55h",
      call("sprite8", 8 * 0, 8, "g8", 1),
    ].join("\n"), data));
    expect(r.ram()[0x4000]).toBe(0xff);
    expect(r.ram()[0x4001]).toBe(0xff); // byte de la derecha: máscara desplazada 0 → no tocado
    expect(r.ram()[pix(0, 1)]).toBe(0x81);
    expect(r.ram()[0x4020]).toBe(0xff); // 55h | FFh
    expect(r.ram()[pix(0, 9)]).toBe(0x81);
  });

  it("sprite16_mask desplazado 4: (pantalla & máscara) | gráfico en tres bytes", async () => {
    const r = await run(program([
      // Fondo: tres bytes FFh en la fila 50 y en la 51.
      ...[50, 51].map((y) => `        ld hl,${pix(40, y)}\n        ld (hl),0FFh\n        inc hl\n        ld (hl),0FFh\n        inc hl\n        ld (hl),0FFh`),
      call("sprite16_mask", 44, 50, "g16b", "mk16"),
    ].join("\n"), data));
    // Fila 0: gráfico F0 0F >> 4 = 0F 00 F0; máscara FF 00 >> 4 con 1 = FF F0 0F.
    // FF&FF|0F = FF; FF&F0|00 = F0; FF&0F|F0 = FF.
    expect([0, 1, 2].map((i) => r.ram()[pix(40, 50) + i])).toEqual([0xff, 0xf0, 0xff]);
    // Fila 1: gráfico 0, máscara FF FF → fondo intacto.
    expect([0, 1, 2].map((i) => r.ram()[pix(40, 51) + i])).toEqual([0xff, 0xff, 0xff]);
  });

  it("sprite16 XOR: 16 filas de 2 bytes; recorte inferior en y = 184", async () => {
    const r = await run(program(call("sprite16", 0, 184, "g16", 0), data));
    for (let y = 184; y < 192; y++) {
      expect(r.ram()[pix(0, y)]).toBe(0xaa);
      expect(r.ram()[pix(8, y)]).toBe(0xaa);
      expect(r.ram()[pix(16, y)]).toBe(0);
    }
    expect(inked(r.ram()).size).toBe(8 * 8);
    expect(r.peek16(r.sym("ix_out"))).toBe(IX_SENTINEL);
  });
});
