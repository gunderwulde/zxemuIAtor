// ULA-20 (teclado), ULA-21 (EAR, Issue 2/3), ULA-22 (escritura en 0xFE) y ULA-23
// (bus flotante) · DOC §6, §8 + REF tests/ref/ula-ports.ts, floatingbus.ts, contention.ts.
// Requiere: C1 (IN/OUT) + M1 (puertos, bus flotante, beeper log). Fallan hasta entonces.
//
// Programas en 0x8000 (RAM no contendida), bytes escritos a mano:
//   ED 78 = IN A,(C)     ED 79 = OUT (C),A     DB n = IN A,(n)     D3 n = OUT (n),A
import { beforeAll, describe, expect, it } from "vitest";
import { lineStart, PATTERNS, runPattern } from "../../ref/contention";
import { floatingBus } from "../../ref/floatingbus";
import { type KeySet, readULA } from "../../ref/ula-ports";
import { attrAddr, bitmapAddr } from "../../ref/video";
import { Probe } from "../../util/probe";

const hex = (v: number, w = 4) => "0x" + v.toString(16).padStart(w, "0");

/** OUT (C),A con BC = port y A = v, en el T actual. */
function out(p: Probe, port: number, v: number): void {
  p.poke(0x8000, [0xed, 0x79]);
  p.setRegs({ pc: 0x8000, bc: port, af: (v << 8) | 0xff, iff1: 0 });
  p.step();
}

/** IN A,(C) con BC = port; devuelve A. */
function inC(p: Probe, port: number): number {
  p.poke(0x8000, [0xed, 0x78]);
  p.setRegs({ pc: 0x8000, bc: port, iff1: 0 });
  p.step();
  return p.regs.get16("af") >> 8;
}

async function probe(): Promise<Probe> {
  const p = await Probe.create();
  p.x.zx_t_set_int_enabled(0);
  p.t = 100;
  return p;
}

const ROW_PORTS = [0xfefe, 0xfdfe, 0xfbfe, 0xf7fe, 0xeffe, 0xdffe, 0xbffe, 0x7ffe]; // DOC §6

describe("[C1+M1] ULA-20 puerto 0xFE: teclado", () => {
  let p: Probe;
  beforeAll(async () => {
    p = await probe();
    out(p, 0x00fe, 0x00); // último byte escrito conocido: EAR = 0
  });

  function press(keys: KeySet, down: boolean) { for (const [r, b] of keys) p.x.zx_key(r, b, down ? 1 : 0); }
  function check(keys: KeySet, ports: number[]): string[] {
    press(keys, true);
    const bad: string[] = [];
    for (const port of ports) {
      const got = inC(p, port), exp = readULA(port, keys, 0x00, 3);
      if (got !== exp) bad.push(`teclas ${JSON.stringify(keys)} puerto ${hex(port)}: ${hex(got, 2)} (esperado ${hex(exp, 2)})`);
    }
    press(keys, false);
    return bad;
  }

  it("cada una de las 40 teclas aislada: sólo su bit a 0 en su semifila", () => {
    const bad: string[] = [];
    for (let r = 0; r < 8; r++) for (let b = 0; b < 5; b++) bad.push(...check([[r, b]], ROW_PORTS));
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it("varias semifilas a la vez → AND", () => {
    const bad = [
      ...check([[0, 0], [7, 4]], [0x00fe, 0x7efe, 0xfefe]),
      ...check([[1, 1], [2, 2], [3, 3], [4, 4]], [0x00fe, 0xe1fe, 0xe7fe]),
    ];
    expect(bad).toEqual([]);
  });

  it("ghosting: tres esquinas de un rectángulo hacen aparecer la cuarta", () => {
    const bad = [
      ...check([[2, 0], [2, 1], [5, 0]], ROW_PORTS), // (5,1) fantasma en 0xDFFE
      ...check([[0, 1], [0, 4], [7, 4]], ROW_PORTS), // (7,1) fantasma
      ...check([[3, 0], [4, 0], [4, 2], [6, 2]], ROW_PORTS), // cadena en L: (3,2) y (6,0) fantasmas
    ];
    expect(bad).toEqual([]);
  });

  it("bits 5 y 7 a 1; cualquier puerto par responde", () => {
    const bad = [...check([[0, 2], [5, 3]], [0x12fe, 0xfe00, 0xfe02, 0x00fe, 0xdf7e])];
    expect(bad).toEqual([]);
  });
});

describe("[C1+M1] ULA-21 bit 6 (EAR) según Issue 2/3", () => {
  it("bits 3/4 escritos × Issue", async () => {
    const bad: string[] = [];
    for (const issue of [2, 3] as const) {
      const p = await probe();
      p.x.zx_set_issue(issue);
      for (const v of [0x00, 0x08, 0x10, 0x18]) {
        out(p, 0x00fe, v);
        const got = inC(p, 0xfefe), exp = readULA(0xfefe, [], v, issue);
        if (got !== exp) bad.push(`Issue ${issue}, escrito ${hex(v, 2)}: ${hex(got, 2)} (esperado ${hex(exp, 2)})`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("[C1+M1] ULA-22 escritura en 0xFE", () => {
  it("bits 0–2 = borde en el framebuffer; bits 5–7 ignorados", async () => {
    for (const v of [0x02, 0xe2, 0x05, 0xa5]) {
      const p = await probe();
      // OUT en T 100 (antes de la primera línea visible, T 3560 · tests/ref/video.ts groupT).
      out(p, 0x00fe, v);
      p.poke(0x8000, [0x18, 0xfe]); // JR $
      p.setRegs({ pc: 0x8000 });
      p.runFrame();
      const fb = p.fb();
      const exp = { 2: [0xd7, 0, 0], 5: [0, 0xd7, 0xd7] }[v & 7]!; // DOC §3: 2 rojo, 5 cian
      for (const [x, y] of [[0, 0], [351, 0], [0, 295], [351, 295], [10, 150], [340, 150]] as const) {
        const o = (y * 352 + x) * 4;
        expect([...fb.subarray(o, o + 3)], `valor ${hex(v, 2)} píxel (${x},${y})`).toEqual(exp);
      }
    }
  });

  it("bits 3/4 en el log del beeper con el T del ciclo de escritura de E/S", async () => {
    const p = await probe();
    const base = p.beeperLog().length;
    // OUT (n),A = D3 FE en T0 = 5000 con A = 0x10 (EAR a 1). Puerto 0x10FE: N:1 → la ULA
    // ve el dato en inicio de E/S + 1 (Fuse peripherals/ula.c: sound_ula(tstates) en
    // ula_write, llamada tras ula_contend_port_early).
    const t0 = 5000;
    p.poke(0x8000, [0xd3, 0xfe]);
    p.setRegs({ pc: 0x8000, af: 0x10ff, iff1: 0 });
    p.t = t0;
    p.step();
    const dataT = runPattern(t0, PATTERNS.outNA(0x8000, 0x10fe)).timings[2]!.dataT!;
    let log = p.beeperLog().slice(base);
    expect(log.map((e) => e.t)).toEqual([dataT]);
    // Sólo bits 5–7 cambian → ningún cambio de nivel.
    p.setRegs({ pc: 0x8000, af: 0xf0ff });
    p.t = 6000;
    p.step();
    expect(p.beeperLog().slice(base)).toHaveLength(1);
    // MIC (bit 3) cambia → transición en su T.
    p.setRegs({ pc: 0x8000, af: 0xf8ff });
    p.t = 7000;
    p.step();
    log = p.beeperLog().slice(base);
    expect(log.map((e) => e.t)).toEqual([dataT, runPattern(7000, PATTERNS.outNA(0x8000, 0xf8fe)).timings[2]!.dataT!]);
    expect(log[1]!.level).not.toBe(log[0]!.level);
  });
});

describe("[C1+M1] ULA-23 bus flotante", () => {
  let p: Probe;
  let ram: Uint8Array;

  beforeAll(async () => {
    p = await probe();
    // Patrón sin colisiones (TEST-PLAN ULA-23): bitmap = 0x80 | (y & 0x3F), atributo =
    // 0xC0 | fila; la línea bajo prueba se reescribe con bitmap = x y atributo = 0x40 | x.
    ram = new Uint8Array(65536);
    for (let y = 0; y < 192; y++) for (let x = 0; x < 32; x++) ram[bitmapAddr(x, y)] = 0x80 | (y & 0x3f);
    for (let y = 0; y < 192; y += 8) for (let x = 0; x < 32; x++) ram[attrAddr(x, y)] = 0xc0 | (y >> 3);
  });

  function setLine(y: number) {
    const m = ram.slice();
    for (let x = 0; x < 32; x++) {
      m[bitmapAddr(x, y)] = x;
      m[attrAddr(x, y)] = 0x40 | x;
    }
    p.poke(0x4000, m.subarray(0x4000, 0x5b00));
    return m;
  }

  // Líneas de TEST-PLAN más las de borde (−1 = última del borde superior, 192 = primera inferior).
  for (const line of [-1, 0, 1, 7, 8, 100, 191, 192]) {
    it(`línea ${line}: IN A,(0xFF)/(0x40FF) con el ciclo de E/S empezando en cada T de la línea`, () => {
      const m = setLine(Math.min(Math.max(line, 0), 191));
      const bad: string[] = [];
      for (const port of [0x00ff, 0x40ff]) {
        for (let off = 0; off < 224; off++) {
          const ioStart = lineStart(line) - 8 + off;
          const t0 = ioStart - 7; // DB n: pc:4, pc+1:3 en 0x8000, sin contención
          p.poke(0x8000, [0xdb, 0xff]);
          p.setRegs({ pc: 0x8000, af: port & 0xff00, iff1: 0 });
          p.t = t0;
          p.step();
          const dataT = runPattern(t0, PATTERNS.inAN(0x8000, port)).timings[2]!.dataT!;
          const got = p.regs.get16("af") >> 8, exp = floatingBus(dataT, m);
          if (got !== exp) bad.push(`puerto ${hex(port)} E/S en ${ioStart} (muestreo ${dataT}): ${hex(got, 2)} (esperado ${hex(exp, 2)})`);
        }
      }
      expect(bad.slice(0, 8)).toEqual([]);
    });
  }

  it("los puertos pares nunca devuelven bus flotante", () => {
    const m = setLine(0);
    void m;
    const bad: string[] = [];
    for (let off = 0; off < 224; off++) {
      const t0 = lineStart(0) - 8 + off - 7;
      p.poke(0x8000, [0xdb, 0xfe]);
      p.setRegs({ pc: 0x8000, af: 0x7f00, iff1: 0 });
      p.t = t0;
      p.step();
      const got = p.regs.get16("af") >> 8;
      if ((got & 0xbf) !== 0xbf) bad.push(`T0 ${t0}: ${hex(got, 2)}`); // sin teclas: bits 0–5 y 7 a 1
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});
