// ULA-22 (borde), ULA-30 (geometría y paleta), ULA-31 (FLASH), ULA-32 (timing del borde),
// ULA-33 (multicolor) y una versión reducida de ULA-34 (perezoso ≡ ingenuo), sobre
// m1-harness.wasm (escrituras y OUT con T exacto sin depender de la CPU).
// Oráculos:
//  - DOC docs §3 (direcciones, atributo, paleta), §7 (byte 16384 en 14336; OUT que
//    termina en 14339–14342 → borde en la posición del byte 16384; 4 T = 8 px).
//  - REF: regla de captura de Fuse (display_dirty.c / display_border.c): el chunk de 8 px
//    emitido en E = 3560 + 224·fy + 4·cx se congela en E + 4; un cambio en T < E + 4 se
//    ve en él. El T del cambio es el fin del ciclo de escritura en memoria y el T tras el
//    primer T del OUT (Fuse memory_pages.c writebyte, periph.c writeport).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attrAddr, buslog, color, EV, FB_H, FB_W, FRAME, harness, LINE, pixAddr, pixel } from "./harness";

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
});
beforeEach(() => {
  h.x.zx_reset();
  h.x.zx_t_set_int_enabled(0);
});

const emit = (fy: number, cx: number) => 3560 + LINE * fy + 4 * cx;

function border(c: number, t0: number) {
  h.x.zx_t_set_tstate(t0);
  h.x.h_out(0x00fe, c);
}

function write(addr: number, v: number, t0: number): number {
  h.x.zx_t_set_tstate(t0);
  h.x.h_write(addr, v);
  return h.x.zx_tstate();
}

describe("ULA-30 geometría y paleta", () => {
  it("paleta: los 16 colores de docs §3 (borde para 0–7, BRIGHT vía atributo)", () => {
    for (let c = 0; c < 8; c++) {
      border(c, 0);
      for (let a = 0x5800; a < 0x5b00; a++) h.x.zx_poke(a, 0x40 | (c << 3));
      h.x.h_end_frame();
      expect(pixel(h.core, 0, 0), `borde ${c}`).toBe(color(c));
      expect(pixel(h.core, 48, 48), `bright ${c}`).toBe(color(c, true));
    }
    const fb = h.core.framebuffer();
    for (let i = 3; i < fb.length; i += 4) if (fb[i] !== 255) throw new Error(`alpha en ${i}`);
  });

  it("cada uno de los 6 144 bytes de bitmap enciende sus 8 píxeles (docs §3, +48/+48)", () => {
    for (let a = 0x5800; a < 0x5b00; a++) h.x.zx_poke(a, 0x38 | 0x01); // papel blanco, tinta azul
    border(7, 0);
    const ink = color(1), paper = color(7);
    for (let y = 0; y < 192; y++)
      for (let x = 0; x < 32; x++) {
        h.x.zx_poke(pixAddr(x, y), 0x81); // patrón asimétrico: primer y último píxel
        h.x.h_end_frame();
        const fy = 48 + y;
        for (let px = 48; px < 304; px++) {
          const on = px === 48 + x * 8 || px === 48 + x * 8 + 7;
          const got = pixel(h.core, px, fy);
          if (got !== (on ? ink : paper)) throw new Error(`byte (${x},${y}) px ${px}: ${got.toString(16)}`);
        }
        // Líneas vecinas intactas en esa columna.
        for (const ny of [fy - 1, fy + 1])
          if (ny >= 48 && ny < 240 && pixel(h.core, 48 + x * 8, ny) !== paper) throw new Error(`fuga a la línea ${ny}`);
        h.x.zx_poke(pixAddr(x, y), 0);
      }
  });

  it("cada uno de los 768 atributos colorea su celda 8×8 (tinta, papel, brillo)", () => {
    for (let a = 0x4000; a < 0x5800; a++) h.x.zx_poke(a, 0xf0); // 4 px tinta, 4 px papel
    for (let i = 0; i < 768; i++) h.x.zx_poke(0x5800 + i, 0x00);
    for (let i = 0; i < 768; i++) {
      const attr = 0x40 | (2 << 3) | 5; // bright, papel rojo, tinta cian
      h.x.zx_poke(0x5800 + i, attr);
      h.x.h_end_frame();
      const cx = i % 32, cy = i >> 5;
      for (let dy = 0; dy < 8; dy++)
        for (let dx = 0; dx < 8; dx++) {
          const got = pixel(h.core, 48 + cx * 8 + dx, 48 + cy * 8 + dy);
          const exp = dx < 4 ? color(5, true) : color(2, true);
          if (got !== exp) throw new Error(`attr ${i} (${dx},${dy}): ${got.toString(16)}`);
        }
      // Celda vecina sigue negra.
      const nx = cx < 31 ? cx + 1 : cx - 1;
      expect(pixel(h.core, 48 + nx * 8, 48 + cy * 8)).toBe(0);
      h.x.zx_poke(0x5800 + i, 0x00);
    }
  });
});

describe("ULA-31 FLASH", () => {
  it("frames 0–15 normal, 16–31 invertido, 32 normal; escribir el atributo no reinicia el contador", () => {
    h.x.zx_poke(0x5800, 0x80 | (1 << 3) | 6); // flash, papel azul, tinta amarilla
    h.x.zx_poke(0x4000, 0xff);
    const seen: number[] = [];
    for (let f = 0; f <= 32; f++) {
      if (f === 20) h.x.zx_poke(0x5800, 0x80 | (1 << 3) | 6);
      h.x.h_end_frame();
      seen.push(pixel(h.core, 48, 48));
    }
    for (let f = 0; f <= 32; f++) {
      const inverted = f >= 16 && f < 32;
      expect(seen[f], `frame ${f}`).toBe(inverted ? color(1) : color(6));
    }
  });
});

describe("ULA-22/32 borde", () => {
  /** Primer chunk (en orden de emisión) con el color nuevo. */
  function firstNew(newColor: number): [number, number] | null {
    for (let fy = 0; fy < FB_H; fy++)
      for (let cx = 0; cx < 44; cx++) {
        const p = pixel(h.core, cx * 8, fy);
        if (p === newColor) return [fy, cx];
      }
    return null;
  }

  // tEnd = final del ciclo de E/S SIN contención (t0 + 4), que es como cuenta docs §7.
  // OJO: 0xFE es un puerto de la ULA (N:1, C:3): en la ventana de pantalla el ciclo se
  // alarga DESPUÉS de que la ULA haya visto el valor (en t0 + 1), así que el final real
  // puede ser posterior (p. ej. 14344 para t0 + 1 = 14336…14339).
  function sweep(tEnd: number) {
    h.x.zx_reset();
    for (let a = 0x5800; a < 0x5b00; a++) h.x.zx_poke(a, 0x38); // pantalla blanca
    border(1, 0);
    h.x.zx_t_buslog_enable(1);
    border(2, tEnd - 4);
    const pw = buslog(h.core).find((e) => e.kind === EV.PW)!;
    h.x.zx_t_buslog_enable(0);
    expect(pw.t).toBe(tEnd - 3);
    h.x.h_end_frame();
  }

  it("DOC §7: un OUT que termina en 14339–14342 cambia el borde en la posición del byte 16384", () => {
    for (let tEnd = 14339; tEnd <= 14342; tEnd++) {
      sweep(tEnd);
      // En la línea 48 del framebuffer (la del byte 16384) el borde izquierdo ya es rojo
      // sólo a partir de x = 48: el chunk anterior (x = 40) sigue azul.
      expect(pixel(h.core, 47, 48), `tEnd=${tEnd}`).toBe(color(1));
      expect(pixel(h.core, 40, 48)).toBe(color(1));
      // Línea 48 entera: borde derecho rojo; línea 49 roja.
      expect(pixel(h.core, 351, 48)).toBe(color(2));
      expect(pixel(h.core, 0, 49)).toBe(color(2));
    }
    sweep(14338);
    expect(pixel(h.core, 40, 48)).toBe(color(2)); // un chunk antes
    expect(pixel(h.core, 39, 48)).toBe(color(1));
    sweep(14343);
    expect(pixel(h.core, 351, 48)).toBe(color(2));
    // El cambio cae en 14340: el primer chunk afectado es el del byte 16385 (pantalla), así
    // que en la línea 48 nada del borde izquierdo es rojo y el derecho sí.
    expect(pixel(h.core, 47, 48)).toBe(color(1));
  });

  it("REF: barrido 14330–14350 y línea 100 a todos los offsets; granularidad 4 T", () => {
    const ends = [...Array.from({ length: 21 }, (_, i) => 14330 + i)];
    for (let o = 0; o < LINE; o++) ends.push(14336 + 100 * LINE + o);
    for (const tEnd of ends) {
      sweep(tEnd);
      const change = tEnd - 3; // T en que la ULA ve el OUT
      // Primer chunk de borde cuyo E + 4 > change.
      let exp: [number, number] | null = null;
      for (let fy = 0; fy < FB_H && !exp; fy++)
        for (let cx = 0; cx < 44; cx++) {
          const screen = fy >= 48 && fy < 240 && cx >= 6 && cx < 38;
          if (!screen && emit(fy, cx) + 4 > change) {
            exp = [fy, cx];
            break;
          }
        }
      expect(firstNew(color(2)), `tEnd=${tEnd}`).toEqual(exp);
    }
    // Cuatro T consecutivos dan la misma imagen.
    const img = (tEnd: number) => {
      sweep(tEnd);
      return Buffer.from(h.core.framebuffer()).toString("base64");
    };
    const base = 14339 + 50 * LINE + 128; // ≡ 14339 (mod 4) y borde derecho (chunks 38–42)
    for (let g = 0; g < 4; g++) {
      const a = img(base + g * 4 + 0);
      for (let k = 1; k < 4; k++) expect(img(base + g * 4 + k) === a, `grupo ${g} k=${k}`).toBe(true);
      expect(img(base + g * 4 + 4) === a).toBe(false);
    }
  });

  it("rayas: varios cambios por línea en borde superior, lateral e inferior", () => {
    for (let a = 0x5800; a < 0x5b00; a++) h.x.zx_poke(a, 0x38);
    border(0, 0);
    // Cambia de color cada 8 T (16 px) durante la línea fy=10 (superior), 100 (lateral) y 260.
    const marks: { t: number; c: number }[] = [];
    for (const fy of [10, 100, 260]) {
      let c = 1;
      for (let cx = 0; cx < 44; cx += 2) {
        const t0 = emit(fy, cx) - 1 - 3; // el cambio (t0+1) cae justo antes de E + 4 … E
        border(c, t0);
        marks.push({ t: t0 + 1, c });
        c = (c % 7) + 1;
      }
    }
    h.x.h_end_frame();
    for (const fy of [10, 100, 260])
      for (let cx = 0; cx < 44; cx++) {
        if (fy === 100 && cx >= 6 && cx < 38) continue;
        const L = emit(fy, cx) + 4;
        let c = 0;
        for (const m of marks) if (m.t < L) c = m.c;
        expect(pixel(h.core, cx * 8 + 3, fy), `fy=${fy} cx=${cx}`).toBe(color(c));
      }
  });
});

describe("ULA-33 multicolor", () => {
  it("atributo escrito antes/después de que la ULA lo capture, con su contención", () => {
    // Celda (0,0): papel blanco → rojo. Línea n de la celda se emite en 14336 + 224n.
    for (let n of [0, 3]) {
      const E = 14336 + LINE * n;
      for (let t0 = E - 12; t0 <= E + 12; t0++) {
        h.x.zx_reset();
        h.x.zx_poke(0x5800, 0x38);
        const tEnd = write(0x5800, 0x10, t0);
        h.x.h_end_frame();
        for (let line = 0; line < 8; line++) {
          const exp = tEnd < 14336 + LINE * line + 4 ? color(2) : color(7);
          expect(pixel(h.core, 48, 48 + line), `n=${n} t0=${t0} tEnd=${tEnd} línea ${line}`).toBe(exp);
        }
        if (n === 0 && tEnd <= 14339) expect(pixel(h.core, 48, 48)).toBe(color(2));
      }
    }
  });

  it("bitmap: el mismo punto de corte", () => {
    for (let t0 = 14336 + 5 * LINE + 40 - 12; t0 <= 14336 + 5 * LINE + 40 + 12; t0++) {
      h.x.zx_reset();
      h.x.zx_poke(attrAddr(10, 5), 0x38 | 2);
      const tEnd = write(pixAddr(10, 5), 0xff, t0);
      h.x.h_end_frame();
      const exp = tEnd < 14336 + 5 * LINE + 40 + 4 ? color(2) : color(7);
      expect(pixel(h.core, 48 + 80, 48 + 5), `t0=${t0} tEnd=${tEnd}`).toBe(exp);
    }
  });

  it("clásico 8×1: un atributo distinto por línea → 8 franjas en una celda", () => {
    h.x.zx_poke(0x5800 + 32 * 4 + 7, 0x00);
    for (let n = 0; n < 8; n++) {
      const E = 14336 + LINE * (32 + n) + 4 * 7; // fila de caracteres 4, columna 7
      write(0x5800 + 32 * 4 + 7, (n << 3) | 0x40, E - 100);
    }
    h.x.h_end_frame();
    for (let n = 0; n < 8; n++) expect(pixel(h.core, 48 + 56, 48 + 32 + n), `línea ${n}`).toBe(color(n, true));
  });
});

let lastBorder = 0; // borde vigente al empezar cada frame del fuzz

describe("ULA-34 (reducido) render perezoso ≡ render ingenuo", () => {
  // Generador determinista (xorshift32).
  function rng(seed: number) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s;
    };
  }

  /** Renderizador REF: un chunk a la vez, aplicando los cambios con T < E + 4. */
  function naive(initMem: Uint8Array, initBorder: number, evs: { t: number; addr: number; v: number }[], frame: number): Uint32Array {
    const mem = initMem.slice();
    let bord = initBorder;
    const out = new Uint32Array(FB_W * FB_H);
    let e = 0;
    const flash = frame & 16 ? 0xff : 0;
    for (let fy = 0; fy < FB_H; fy++)
      for (let cx = 0; cx < 44; cx++) {
        const L = emit(fy, cx) + 4;
        while (e < evs.length && evs[e]!.t < L) {
          const ev = evs[e++]!;
          if (ev.addr < 0) bord = ev.v & 7;
          else mem[ev.addr] = ev.v;
        }
        const y = fy - 48, x = cx - 6;
        for (let b = 0; b < 8; b++) {
          let c: number;
          if (y < 0 || y >= 192 || x < 0 || x >= 32) c = color(bord);
          else {
            const a = mem[attrAddr(x, y)]!;
            const p = mem[pixAddr(x, y)]! ^ (a & 0x80 ? flash : 0);
            const bright = (a & 0x40) !== 0;
            c = (p << b) & 0x80 ? color(a & 7, bright) : color((a >> 3) & 7, bright);
          }
          out[fy * FB_W + cx * 8 + b] = c;
        }
      }
    return out;
  }

  it("50 frames con escrituras y OUT aleatorios (incl. varios por grupo de 4 T y en límites de línea)", () => {
    const r = rng(0x5eed);
    for (let frame = 0; frame < 50; frame++) {
      const initMem = h.core.ram().slice();
      const evs: { t: number; addr: number; v: number }[] = [];
      let t = r() % 200;
      while (true) {
        t += r() % (r() % 4 === 0 ? 3000 : 40);
        if (t > FRAME - 30) break;
        if (r() % 5 === 0) {
          const v = r() & 7;
          border(v, t);
          evs.push({ t: t + 1, addr: -1, v });
        } else {
          const addr = 0x4000 + (r() % 6912);
          const v = r() & 0xff;
          const tEnd = write(addr, v, t);
          evs.push({ t: tEnd, addr, v });
        }
        t = h.x.zx_tstate();
      }
      const ref = naive(initMem, lastBorder, evs, frame);
      h.x.h_end_frame();
      for (const ev of evs) if (ev.addr < 0) lastBorder = ev.v;
      const got = new Uint32Array(FB_W * FB_H);
      const fb = h.core.framebuffer();
      for (let i = 0; i < got.length; i++) got[i] = (fb[i * 4]! << 16) | (fb[i * 4 + 1]! << 8) | fb[i * 4 + 2]!;
      let bad = -1;
      for (let i = 0; i < got.length && bad < 0; i++) if (got[i] !== ref[i]) bad = i;
      expect(bad, `frame ${frame}: primer píxel distinto en (${bad % FB_W}, ${Math.floor(bad / FB_W)})`).toBe(-1);
    }
  });
});
