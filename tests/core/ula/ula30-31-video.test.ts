// ULA-30 (geometría y paleta) y ULA-31 (FLASH) · DOC §3, §7 + REF tests/ref/video.ts.
// Requiere SÓLO M1 (video.c): la memoria se escribe con zx_poke al principio del frame
// (antes de la primera línea visible) y el frame se dibuja con zx_run_frame. La CPU
// ejecuta un JR $ en 0x8000 (con el stub de fase 0, NOPs que sólo leen).
//
// Sólo se compara el área de pantalla (256×192 en (48,48)): el color de borde tras el
// reset no está especificado en docs y sin CPU no se puede fijar con un OUT.
import { describe, expect, it } from "vitest";
import { attrAddr, bitmapAddr, BORDER_LEFT, BORDER_TOP, FB_WIDTH, flashInvertedForFrame, paletteRGB, renderFrame } from "../../ref/video";
import { Probe } from "../../util/probe";

async function videoProbe(): Promise<Probe> {
  const p = await Probe.create();
  p.x.zx_t_set_int_enabled(0);
  p.poke(0x8000, [0x18, 0xfe]); // JR $
  p.setRegs({ pc: 0x8000, iff1: 0, iff2: 0 });
  return p;
}

/** Pone 0x4000–0x5AFF (6912 bytes) con zx_poke en el T actual. */
function fillScreen(p: Probe, scr: Uint8Array) { p.poke(0x4000, scr); }

/** Diferencias en el área de pantalla entre el framebuffer y el REF. */
function screenDiff(fb: Uint8Array, ref: Uint8Array, max = 5): string[] {
  const out: string[] = [];
  for (let y = 0; y < 192 && out.length < max; y++) {
    for (let x = 0; x < 256 && out.length < max; x++) {
      const o = ((y + BORDER_TOP) * FB_WIDTH + x + BORDER_LEFT) * 4;
      for (let c = 0; c < 4; c++) {
        if (fb[o + c] !== ref[o + c]) {
          out.push(`pantalla (${x},${y}): ${[...fb.subarray(o, o + 4)]} esperado ${[...ref.subarray(o, o + 4)]}`);
          break;
        }
      }
    }
  }
  return out;
}

const pixel = (fb: Uint8Array, x: number, y: number) => {
  const o = ((y + BORDER_TOP) * FB_WIDTH + x + BORDER_LEFT) * 4;
  return [fb[o]!, fb[o + 1]!, fb[o + 2]!, fb[o + 3]!];
};
const WHITE = [0xd7, 0xd7, 0xd7, 0xff];
const BLACK = [0, 0, 0, 0xff];
const same = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);

describe("[M1] ULA-30 geometría de la pantalla", () => {
  it("cada byte de bitmap enciende exactamente sus 8 píxeles (código binario en 13 frames)", async () => {
    // Frame k: el byte de desplazamiento o = addr − 0x4000 vale 0xFF si el bit k de o es 1.
    // Al final, cada píxel (x, y) ha "visto" los 13 bits de su dirección, que debe ser la
    // de DOC §3. Equivale a encender los 6144 bytes uno a uno.
    const p = await videoProbe();
    const code = new Int32Array(256 * 192);
    for (let k = 0; k < 13; k++) {
      const scr = new Uint8Array(6912);
      for (let o = 0; o < 6144; o++) scr[o] = (o >> k) & 1 ? 0xff : 0x00;
      scr.fill(0x07, 6144); // tinta blanca, papel negro, sin brillo ni FLASH
      fillScreen(p, scr);
      p.runFrame();
      const fb = p.fb();
      for (let y = 0; y < 192; y++) {
        for (let x = 0; x < 256; x++) {
          const px = pixel(fb, x, y);
          if (same(px, WHITE)) code[y * 256 + x]! |= 1 << k;
          else if (!same(px, BLACK)) code[y * 256 + x] = -1e9; // color inesperado
        }
      }
    }
    const bad: string[] = [];
    for (let y = 0; y < 192 && bad.length < 8; y++) {
      for (let x = 0; x < 256 && bad.length < 8; x++) {
        const exp = bitmapAddr(x >> 3, y) - 0x4000;
        const got = code[y * 256 + x]!;
        if (got !== exp) bad.push(`(${x},${y}): dirección ${got < 0 ? "color inválido" : "0x" + (got + 0x4000).toString(16)} (esperado 0x${(exp + 0x4000).toString(16)})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("bytes sueltos a 0xFF (primero, último, cambios de tercio/fila) coinciden con el REF", async () => {
    const p = await videoProbe();
    const addrs = [0x4000, 0x401f, 0x4020, 0x40ff, 0x4100, 0x47ff, 0x4800, 0x4fe0, 0x5000, 0x57ff, 0x4321, 0x5555];
    for (const a of addrs) {
      const scr = new Uint8Array(6912).fill(0x07, 6144);
      scr[a - 0x4000] = 0xff;
      fillScreen(p, scr);
      p.runFrame();
      const ref = renderFrame({ screen: scr, border: 0, flashInverted: false, events: [] });
      expect(screenDiff(p.fb(), ref), `byte 0x${a.toString(16)}`).toEqual([]);
    }
  });

  it("cada uno de los 768 atributos colorea su celda 8×8 (código binario en 10 frames)", async () => {
    const p = await videoProbe();
    const code = new Int32Array(256 * 192);
    for (let k = 0; k < 10; k++) {
      const scr = new Uint8Array(6912).fill(0xf0, 0, 6144); // 4 px de tinta + 4 de papel
      for (let i = 0; i < 768; i++) scr[6144 + i] = (i >> k) & 1 ? 0x38 : 0x07; // 1: papel blanco/tinta negra
      fillScreen(p, scr);
      p.runFrame();
      const fb = p.fb();
      for (let y = 0; y < 192; y++) {
        for (let x = 0; x < 256; x++) {
          const ink = (x & 7) < 4;
          const px = pixel(fb, x, y);
          // bit a 1 → la mitad de tinta es negra y la de papel blanca
          const one = ink ? same(px, BLACK) : same(px, WHITE);
          const zero = ink ? same(px, WHITE) : same(px, BLACK);
          if (one) code[y * 256 + x]! |= 1 << k;
          else if (!zero) code[y * 256 + x] = -1e9;
        }
      }
    }
    const bad: string[] = [];
    for (let y = 0; y < 192 && bad.length < 8; y++) {
      for (let x = 0; x < 256 && bad.length < 8; x++) {
        const exp = attrAddr(x >> 3, y) - 0x5800;
        if (code[y * 256 + x] !== exp) bad.push(`(${x},${y}): atributo ${code[y * 256 + x]} (esperado ${exp})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("paleta: tinta, papel y brillo de las 128 combinaciones con los 16 RGBA de DOC §3", async () => {
    const p = await videoProbe();
    const scr = new Uint8Array(6912).fill(0xf0, 0, 6144);
    for (let i = 0; i < 768; i++) scr[6144 + i] = i & 0x7f; // sin FLASH
    fillScreen(p, scr);
    p.runFrame();
    const fb = p.fb();
    const bad: string[] = [];
    for (let i = 0; i < 128; i++) {
      const x = (i % 32) * 8, y = Math.floor(i / 32) * 8;
      const bright = (i >> 3) & 8;
      const ink = [...paletteRGB((i & 7) | bright), 0xff], paper = [...paletteRGB(((i >> 3) & 7) | bright), 0xff];
      if (!same(pixel(fb, x, y), ink)) bad.push(`attr ${i} tinta ${pixel(fb, x, y)} (esperado ${ink})`);
      if (!same(pixel(fb, x + 7, y + 7), paper)) bad.push(`attr ${i} papel ${pixel(fb, x + 7, y + 7)} (esperado ${paper})`);
    }
    expect(bad.slice(0, 8)).toEqual([]);
    expect(screenDiff(fb, renderFrame({ screen: scr, border: 0, flashInverted: false, events: [] }))).toEqual([]);
  });
});

describe("[M1] ULA-31 FLASH", () => {
  it("frames 0–15 normal, 16–31 invertido, 32 normal; el contador no se reinicia al escribir atributos", async () => {
    const p = await videoProbe();
    expect(p.x.zx_frame_count()).toBe(0);
    const scr = new Uint8Array(6912);
    scr[0] = 0xf0; // celda 0, línea 0: 4 px de tinta
    scr[6144] = 0x80 | 0x07; // FLASH, tinta blanca, papel negro
    scr[6145] = 0x07; // celda 1 sin FLASH (control)
    scr[1] = 0xf0;
    fillScreen(p, scr);
    const bad: string[] = [];
    for (let f = 0; f <= 33; f++) {
      if (f === 10 || f === 20) {
        // Reescribir el atributo (otro color de tinta) no debe reiniciar la fase.
        scr[6144] = 0x80 | (f === 10 ? 0x02 : 0x04);
        p.poke(0x5800, [scr[6144]!]);
      }
      const frame = p.x.zx_frame_count();
      p.runFrame();
      const ref = renderFrame({ screen: scr, border: 0, flashInverted: flashInvertedForFrame(frame), events: [] });
      const d = screenDiff(p.fb(), ref, 1);
      if (d.length) bad.push(`frame ${frame}: ${d[0]}`);
    }
    expect(bad).toEqual([]);
  });
});
