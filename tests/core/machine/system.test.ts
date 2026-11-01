// Pruebas de M1 que necesitan la CPU real de C1 (se saltan mientras z80.c sea el stub
// de fase 0) y medida del coste del render.
//  - SYS-01 (ROM): la ROM arranca y el FRAMEBUFFER (no la RAM) muestra el mensaje de
//    copyright, leído con la fuente de la propia ROM (0x3D00). Oráculo ROM.
//  - ULA-03 con instrucciones reales: IN A,(n) / OUT (n),A, T total = DOC §5 + M1/lecturas.
//  - Coste del render: informativo, con un límite holgado.
import { describe, expect, it } from "vitest";
import { rom48 } from "../../util/wasm";
import { color, FB_W, harness, pixel, probe, refContention } from "./harness";

// Se decide al cargar el módulo (no en beforeAll): it.skipIf se evalúa al recoger los tests.
const p = await probe();
// LD A,0x42 en 0x8000: el stub lo ejecuta como dos NOP y no toca A.
p.x.zx_reset();
p.core.ram().set([0x3e, 0x42], 0x8000);
p.x.zx_set_pc(0x8000);
p.x.zx_step();
const cpuReal = p.core.regs.snapshot().af >> 8 === 0x42 && p.core.regs.snapshot().pc === 0x8002;
if (!cpuReal) console.warn("[M1] z80.c sigue siendo el stub: se saltan los tests que necesitan la CPU real");

/** OCR de una línea de texto del framebuffer con la fuente de la ROM (0x20–0x7F). */
function screenLine(row: number): string {
  const rom = rom48();
  const paperOf = (cx: number) => pixel(p.core, 48 + cx * 8 + 7, 48 + row * 8 + 7);
  let s = "";
  for (let cx = 0; cx < 32; cx++) {
    const paper = paperOf(cx);
    const glyph: number[] = [];
    for (let dy = 0; dy < 8; dy++) {
      let b = 0;
      for (let dx = 0; dx < 8; dx++) if (pixel(p.core, 48 + cx * 8 + dx, 48 + row * 8 + dy) !== paper) b |= 0x80 >> dx;
      glyph.push(b);
    }
    let ch = "?";
    for (let c = 0x20; c < 0x80; c++) {
      const f = rom.subarray(0x3d00 + (c - 0x20) * 8, 0x3d00 + (c - 0x20) * 8 + 8);
      if (glyph.every((g, i) => g === f[i])) {
        ch = c === 0x7f ? "©" : String.fromCharCode(c);
        break;
      }
    }
    s += ch;
  }
  return s;
}

describe("SYS-01 arranque (CPU real)", () => {
  it.skipIf(!cpuReal)("tras 150 frames el framebuffer muestra © 1982 Sinclair Research Ltd y borde blanco", () => {
    p.core.loadRom(rom48());
    p.x.zx_t_set_int_enabled(1);
    p.x.zx_reset();
    for (let i = 0; i < 150; i++) p.core.runFrame();
    expect(screenLine(23)).toContain("© 1982 Sinclair Research Ltd");
    expect(pixel(p.core, 0, 0)).toBe(color(7));
    expect(pixel(p.core, FB_W - 1, 295)).toBe(color(7));
    for (let row = 0; row < 23; row++) expect(screenLine(row).trim(), `fila ${row}`).toBe("");
  });
});

describe("ULA-03 con instrucciones reales (CPU real)", () => {
  // IN A,(n): M1 pc:4, pc+1:3, E/S 4.  OUT (n),A: igual. Código en 0x8000 (sin contención).
  for (const [op, name] of [[0xdb, "IN A,(n)"], [0xd3, "OUT (n),A"]] as const)
    for (const port of [0x00fe, 0x40fe, 0x00ff, 0x40ff])
      it.skipIf(!cpuReal)(`${name} puerto 0x${port.toString(16)} en las fases 0..7 de la línea 10`, () => {
        for (let k = 0; k < 8; k++) {
          p.x.zx_reset();
          p.x.zx_t_set_int_enabled(0);
          p.core.ram().set([op, port & 0xff], 0x8000);
          const r = p.core.regs;
          r.set16("af", (port & 0xff00) | 0x00);
          p.x.zx_set_pc(0x8000);
          const io0 = 14335 + 10 * 224 + k; // inicio del ciclo de E/S
          p.x.zx_t_set_tstate(io0 - 7);
          p.x.zx_step();
          let t = io0;
          const hi = (port & 0xc000) === 0x4000, ula = !(port & 1);
          const steps: [boolean, number][] = !hi && ula ? [[false, 1], [true, 3]] : !hi ? [[false, 4]]
            : ula ? [[true, 1], [true, 3]] : [[true, 1], [true, 1], [true, 1], [true, 1]];
          for (const [c, n] of steps) t += (c ? refContention(t) : 0) + n;
          expect(p.x.zx_tstate(), `k=${k}`).toBe(t);
        }
      });
});

describe("coste del render", () => {
  it("frame completo y frame con 6 912 escrituras en pantalla", async () => {
    const h = await harness();
    h.x.zx_reset();
    for (let a = 0x4000; a < 0x5b00; a++) h.x.zx_poke(a, (a * 37) & 0xff);
    const N = 300;
    // 1) Render completo del frame de golpe (fin de frame sin escrituras intermedias).
    h.x.h_end_frame();
    let t0 = performance.now();
    for (let i = 0; i < N; i++) h.x.h_end_frame();
    const full = (performance.now() - t0) / N;
    // 2) Frame con una escritura en cada byte de pantalla repartida por el frame
    //    (cada una provoca un catch-up con el T real): peor caso realista de catch-up.
    t0 = performance.now();
    for (let i = 0; i < N / 10; i++) {
      for (let j = 0; j < 6912; j++) {
        h.x.zx_t_set_tstate(10 * j);
        h.x.h_write(0x4000 + j, j & 0xff);
      }
      h.x.h_end_frame();
    }
    const busy = (performance.now() - t0) / (N / 10);
    // 3) El mismo bucle de escrituras en 0x8000 (sin catch-up): coste de las llamadas JS→wasm.
    t0 = performance.now();
    for (let i = 0; i < N / 10; i++)
      for (let j = 0; j < 6912; j++) {
        h.x.zx_t_set_tstate(10 * j);
        h.x.h_write(0x8000 + j, j & 0xff);
      }
    const calls = (performance.now() - t0) / (N / 10);
    console.log(`[M1] render frame completo: ${full.toFixed(3)} ms; frame con 6912 escrituras: ${busy.toFixed(3)} ms ` +
      `(llamadas JS→wasm sin vídeo: ${calls.toFixed(3)} ms); presupuesto 20 ms`);
    expect(full).toBeLessThan(2);
    expect(busy - calls).toBeLessThan(3);
  });
});
