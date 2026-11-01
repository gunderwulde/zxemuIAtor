// M3 — snapshots SNA y Z80 v1–v3 (docs/zx48-hardware.md §11).
// Los ficheros se construyen aquí a partir de la especificación publicada (WoS "Z80 file
// format", libspectrum sna.c/z80.c); el compresor de referencia es independiente del
// descompresor del núcleo.
import { beforeAll, describe, expect, it } from "vitest";
import { Core } from "../../../web/src/emu/core";
import type { RegsSnapshot } from "../../../web/src/emu/regs";
import { instantiate, rom48 } from "../../util/wasm";

const OK = 0, ERR_SIZE = -1, ERR_FORMAT = -2, ERR_MODEL = -3;

let core: Core;
beforeAll(async () => {
  core = new Core(await instantiate("core-probe"));
  core.loadRom(rom48());
});

/** PRNG determinista (xorshift32). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s & 0xff;
  };
}

/** RAM de 48K con zonas comprimibles: rachas largas, ED sueltos, pares ED ED, ruido. */
function makeRam(seed: number): Uint8Array {
  const r = rng(seed);
  const m = new Uint8Array(49152);
  for (let i = 0; i < m.length; i++) m[i] = r();
  m.fill(0, 0, 6144);                 // pantalla a cero (racha > 255)
  m.fill(0x38, 6144, 6912);           // atributos
  m.set([0xed, 0x01, 0xed, 0xed, 0x02, 0xed, 0xed, 0xed, 0x00, 0xed], 8000);
  m.fill(0xed, 9000, 9300);           // racha de ED > 255
  m.set([0x11, 0x11, 0x11, 0x11], 9400); // racha de 4: debe ir literal
  m.set([0xed, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22], 9500); // ED suelto seguido de racha
  m[49151] = 0xed;                    // ED al final
  return m;
}

/** Compresor de referencia según la especificación Z80: ED ED nn bb para rachas de
 *  5 o más bytes (o de 2 o más ED); el byte que sigue a un ED suelto nunca empieza racha. */
function z80compress(src: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const b = src[i]!;
    let run = 1;
    while (i + run < src.length && src[i + run] === b && run < 255) run++;
    if (run >= 5 || (b === 0xed && run >= 2)) {
      out.push(0xed, 0xed, run, b);
      i += run;
    } else if (b === 0xed) {
      out.push(0xed);
      i++;
      if (i < src.length) out.push(src[i++]!);
    } else {
      out.push(b);
      i++;
    }
  }
  return out;
}

/** Descompresor de referencia (sólo para validar el compresor del test). */
function z80expand(src: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < src.length;) {
    if (src[i] === 0xed && src[i + 1] === 0xed) {
      for (let k = 0; k < src[i + 2]!; k++) out.push(src[i + 3]!);
      i += 4;
    } else out.push(src[i++]!);
  }
  return out;
}

interface Cpu {
  a: number; f: number; bc: number; de: number; hl: number;
  a_: number; f_: number; bc_: number; de_: number; hl_: number;
  ix: number; iy: number; sp: number; pc: number;
  i: number; r: number; iff1: number; iff2: number; im: number;
  border: number;
}

const CPU: Cpu = {
  a: 0x12, f: 0xd7, bc: 0x3456, de: 0x789a, hl: 0xbcde,
  a_: 0xf0, f_: 0x0f, bc_: 0x1357, de_: 0x2468, hl_: 0x9bdf,
  ix: 0xa1b2, iy: 0x5c3a, sp: 0xff40, pc: 0x8123,
  i: 0x3f, r: 0xc5, iff1: 1, iff2: 1, im: 1, border: 5,
};

function expectRegs(r: RegsSnapshot, c: Cpu) {
  expect(r.af).toBe((c.a << 8) | c.f);
  expect(r.bc).toBe(c.bc);
  expect(r.de).toBe(c.de);
  expect(r.hl).toBe(c.hl);
  expect(r.af_).toBe((c.a_ << 8) | c.f_);
  expect(r.bc_).toBe(c.bc_);
  expect(r.de_).toBe(c.de_);
  expect(r.hl_).toBe(c.hl_);
  expect(r.ix).toBe(c.ix);
  expect(r.iy).toBe(c.iy);
  expect(r.sp).toBe(c.sp);
  expect(r.pc).toBe(c.pc);
  expect(r.i).toBe(c.i);
  expect(r.r).toBe(c.r);
  expect(r.iff1).toBe(c.iff1);
  expect(r.iff2).toBe(c.iff2);
  expect(r.im).toBe(c.im);
  expect(r.halted).toBe(0);
}

const w16 = (b: Uint8Array, o: number, v: number) => { b[o] = v & 0xff; b[o + 1] = v >> 8; };

/** Cabecera Z80 de 30 bytes (offsets de la especificación). */
function z80header(c: Cpu, pc: number, compressed: boolean): Uint8Array {
  const h = new Uint8Array(30);
  h[0] = c.a; h[1] = c.f;
  w16(h, 2, c.bc); w16(h, 4, c.hl); w16(h, 6, pc); w16(h, 8, c.sp);
  h[10] = c.i; h[11] = c.r & 0x7f;
  h[12] = (c.r >> 7) | (c.border << 1) | (compressed ? 0x20 : 0);
  w16(h, 13, c.de); w16(h, 15, c.bc_); w16(h, 17, c.de_); w16(h, 19, c.hl_);
  h[21] = c.a_; h[22] = c.f_;
  w16(h, 23, c.iy); w16(h, 25, c.ix);
  h[27] = c.iff1; h[28] = c.iff2; h[29] = c.im;
  return h;
}

const cat = (...parts: (Uint8Array | number[])[]) => {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** Z80 v2/v3: cabecera + extensión + bloques por página (48K: 8→4000, 4→8000, 5→C000). */
function z80v23(c: Cpu, ram: Uint8Array, opts: { ext: 23 | 54 | 55; hw: number; compress: boolean; b37?: number; order?: number[]; extraPage?: boolean }) {
  const h = z80header(c, 0, false);
  const ext = new Uint8Array(2 + opts.ext);
  w16(ext, 0, opts.ext);
  w16(ext, 2, c.pc);
  ext[4] = opts.hw;
  ext[7] = opts.b37 ?? 0;
  const pages: Record<number, number> = { 8: 0, 4: 1, 5: 2 };
  const blocks: (Uint8Array | number[])[] = [];
  if (opts.extraPage) blocks.push([0xff, 0xff, 0x00], new Uint8Array(16384).fill(0x77)); // página ROM: se ignora
  for (const p of opts.order ?? [8, 4, 5]) {
    const data = ram.subarray(pages[p]! * 16384, pages[p]! * 16384 + 16384);
    if (opts.compress) {
      const z = z80compress(data);
      blocks.push([z.length & 0xff, z.length >> 8, p], z);
    } else {
      blocks.push([0xff, 0xff, p], data);
    }
  }
  return cat(h, ext, ...blocks);
}

function sna(c: Cpu, ram: Uint8Array): Uint8Array {
  // El PC va en la pila: SP del fichero = SP real - 2.
  const f = new Uint8Array(27 + 49152);
  const sp = (c.sp - 2) & 0xffff;
  f[0] = c.i;
  w16(f, 1, c.hl_); w16(f, 3, c.de_); w16(f, 5, c.bc_); w16(f, 7, (c.a_ << 8) | c.f_);
  w16(f, 9, c.hl); w16(f, 11, c.de); w16(f, 13, c.bc); w16(f, 15, c.iy); w16(f, 17, c.ix);
  f[19] = c.iff2 ? 4 : 0;
  f[20] = c.r;
  w16(f, 21, (c.a << 8) | c.f); w16(f, 23, sp);
  f[25] = c.im; f[26] = c.border;
  f.set(ram, 27);
  f[27 + sp - 0x4000] = c.pc & 0xff;
  f[27 + sp + 1 - 0x4000] = c.pc >> 8;
  return f;
}

const ramOf = () => core.ram().slice(0x4000);

describe("compresor de referencia del test", () => {
  it("es reversible y respeta las reglas del formato", () => {
    const ram = makeRam(7);
    const z = z80compress(ram);
    expect(z.length).toBeLessThan(ram.length);
    expect(Uint8Array.from(z80expand(z))).toEqual(ram);
    // Racha de 4 literal; ED suelto seguido de racha: ED, 22 literal y luego racha de 5.
    expect(z80compress(Uint8Array.from([0x11, 0x11, 0x11, 0x11]))).toEqual([0x11, 0x11, 0x11, 0x11]);
    expect(z80compress(Uint8Array.from([0xed, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22])))
      .toEqual([0xed, 0x22, 0xed, 0xed, 5, 0x22]);
    expect(z80compress(Uint8Array.from([0xed, 0xed]))).toEqual([0xed, 0xed, 2, 0xed]);
  });
});

describe("SNA", () => {
  it("carga: registros de la cabecera y POP PC", () => {
    const ram = makeRam(1);
    const f = sna(CPU, ram);
    expect(core.loadSna(f)).toBe(OK);
    expectRegs(core.regs.snapshot(), { ...CPU });
    // La RAM queda tal cual el fichero (el PC sigue escrito bajo SP: POP no borra).
    expect(ramOf()).toEqual(f.subarray(27));
  });

  it("round-trip bit a bit: guardar tras cargar reproduce el fichero", () => {
    for (const seed of [2, 3]) {
      const c = { ...CPU, iff1: seed & 1, iff2: seed & 1, im: seed === 2 ? 2 : 0, border: seed, r: 0x80 | seed, sp: 0x8002 };
      const f = sna(c, makeRam(seed));
      expect(core.loadSna(f)).toBe(OK);
      const out = core.saveSna();
      expect(out.length).toBe(49179);
      expect(out).toEqual(f);
    }
  });

  it("guardar no modifica la máquina", () => {
    expect(core.loadSna(sna(CPU, makeRam(4)))).toBe(OK);
    const r0 = core.regs.snapshot();
    const m0 = core.ram().slice();
    core.saveSna();
    expect(core.regs.snapshot()).toEqual(r0);
    expect(core.ram()).toEqual(m0);
  });

  it("rechaza longitudes distintas de 49179 e IM inválido", () => {
    const f = sna(CPU, makeRam(5));
    expect(core.loadSna(f.subarray(0, 49178))).toBe(ERR_SIZE);
    expect(core.loadSna(cat(f, [0]))).toBe(ERR_SIZE);
    const bad = f.slice();
    bad[25] = 3;
    expect(core.loadSna(bad)).toBe(ERR_FORMAT);
  });
});

describe("Z80", () => {
  function loadAndCheck(file: Uint8Array, c: Cpu, ram: Uint8Array) {
    // Estado previo distinto para que un campo no cargado se note.
    core.x.zx_reset();
    expect(core.loadZ80(file)).toBe(OK);
    expectRegs(core.regs.snapshot(), c);
    expect(ramOf()).toEqual(ram);
    // El borde se observa a través del SNA guardado (byte 26).
    expect(core.saveSna()[26]).toBe(c.border);
  }

  it("v1 comprimido (con marcador final 00 ED ED 00)", () => {
    const ram = makeRam(10);
    const f = cat(z80header(CPU, CPU.pc, true), z80compress(ram), [0x00, 0xed, 0xed, 0x00]);
    expect(f.length).toBeLessThan(30 + 49152);
    loadAndCheck(f, CPU, ram);
  });

  it("v1 comprimido sin marcador final", () => {
    const ram = makeRam(11);
    const c = { ...CPU, r: 0x05, border: 0, iff1: 0, iff2: 0, im: 2 };
    loadAndCheck(cat(z80header(c, c.pc, true), z80compress(ram)), c, ram);
  });

  it("v1 sin comprimir; byte 12 = 255 cuenta como 1", () => {
    const ram = makeRam(12);
    loadAndCheck(cat(z80header(CPU, CPU.pc, false), ram), CPU, ram);
    const h = z80header({ ...CPU, r: 0x05 }, CPU.pc, false);
    h[12] = 0xff;
    loadAndCheck(cat(h, ram), { ...CPU, r: 0x85, border: 0 }, ram);
  });

  it("v2 sin comprimir y comprimido, páginas en cualquier orden", () => {
    const ram = makeRam(20);
    loadAndCheck(z80v23(CPU, ram, { ext: 23, hw: 0, compress: false }), CPU, ram);
    loadAndCheck(z80v23(CPU, ram, { ext: 23, hw: 1, compress: true, order: [5, 8, 4] }), CPU, ram);
  });

  it("v3 (54 y 55) sin comprimir y comprimido; 48K+MGT y página ajena ignorada", () => {
    const ram = makeRam(30);
    loadAndCheck(z80v23(CPU, ram, { ext: 54, hw: 0, compress: false }), CPU, ram);
    loadAndCheck(z80v23(CPU, ram, { ext: 54, hw: 0, compress: true, order: [4, 5, 8] }), CPU, ram);
    loadAndCheck(z80v23(CPU, ram, { ext: 55, hw: 3, compress: true, extraPage: true }), CPU, ram);
  });

  it("rechaza otros modelos con ZX_ERR_MODEL sin tocar la máquina", () => {
    const ram = makeRam(40);
    expect(core.loadSna(sna(CPU, makeRam(41)))).toBe(OK);
    const before = core.ram().slice();
    for (const [ext, hw, b37] of [[23, 3, 0], [23, 4, 0], [23, 2, 0], [54, 4, 0], [54, 7, 0], [54, 12, 0], [54, 0, 0x80], [23, 0, 0x80]] as const)
      expect(core.loadZ80(z80v23(CPU, ram, { ext, hw, compress: true, b37 })), `ext ${ext} hw ${hw} b37 ${b37}`).toBe(ERR_MODEL);
    expect(core.ram()).toEqual(before);
  });

  it("valida tamaños y contenido", () => {
    const ram = makeRam(50);
    expect(core.loadZ80(new Uint8Array(29))).toBe(ERR_SIZE);
    // v1 sin comprimir truncado / v1 comprimido que no llega a 48K / basura tras el marcador.
    expect(core.loadZ80(cat(z80header(CPU, CPU.pc, false), ram.subarray(1)))).toBe(ERR_SIZE);
    const z = z80compress(ram);
    expect(core.loadZ80(cat(z80header(CPU, CPU.pc, true), z.slice(0, z.length - 10)))).toBe(ERR_FORMAT);
    expect(core.loadZ80(cat(z80header(CPU, CPU.pc, true), z, [0, 0xed, 0xed, 0, 1]))).toBe(ERR_FORMAT);
    // v2: longitud de cabecera extendida desconocida.
    const v2 = z80v23(CPU, ram, { ext: 23, hw: 0, compress: true });
    const badExt = v2.slice(); badExt[30] = 30;
    expect(core.loadZ80(badExt)).toBe(ERR_FORMAT);
    // v2: falta una página / bloque truncado / página repetida.
    const noPage = z80v23(CPU, ram, { ext: 23, hw: 0, compress: false, order: [8, 4] });
    expect(core.loadZ80(noPage)).toBe(ERR_FORMAT);
    expect(core.loadZ80(v2.subarray(0, v2.length - 1))).toBe(ERR_SIZE);
    const dup = z80v23(CPU, ram, { ext: 23, hw: 0, compress: false, order: [8, 4, 4, 5] });
    expect(core.loadZ80(dup)).toBe(ERR_FORMAT);
    // v2: bloque comprimido que se expande a más de 16 KB.
    const runs = Array.from({ length: 65 }, () => [0xed, 0xed, 0xff, 0x00]).flat(); // 65 × 255 > 16384
    const over = cat(z80header(CPU, 0, false), [23, 0, CPU.pc & 0xff, CPU.pc >> 8, 0], new Uint8Array(20),
      [runs.length & 0xff, runs.length >> 8, 8], runs);
    expect(core.loadZ80(over)).toBe(ERR_FORMAT);
  });

  // Hallazgos de la revisión de la fase 1 (F1).
  it("v2: un bloque de longitud 0 no cuenta como página cargada", () => {
    // Formato (WoS "Z80 file format"): cada bloque comprimido se expande a 16384 bytes
    // exactos. Un bloque vacío no es una página: antes se marcaba como vista y la RAM
    // quedaba con lo descomprimido en una carga anterior.
    const ram = makeRam(60);
    expect(core.loadZ80(z80v23(CPU, ram, { ext: 23, hw: 0, compress: true }))).toBe(OK);
    const h = z80v23(CPU, makeRam(61), { ext: 23, hw: 0, compress: false, order: [8, 4] });
    const empty = cat(h, [0, 0, 5]);
    expect(core.loadZ80(empty)).toBe(ERR_FORMAT);
    // Bloque comprimido que se expande a menos de 16 KB y deja bytes sin consumir: no.
    const short = cat(h, [5, 0, 5], [0xed, 0xed, 10, 0x55, 0x01]);
    expect(core.loadZ80(short)).toBe(ERR_FORMAT);
  });

  it("v1 comprimido: los 4 bytes finales sólo pueden ser el marcador 00 ED ED 00", () => {
    const ram = makeRam(62);
    const z = z80compress(ram);
    expect(core.loadZ80(cat(z80header(CPU, CPU.pc, true), z, [1, 2, 3, 4]))).toBe(ERR_FORMAT);
    expect(core.loadZ80(cat(z80header(CPU, CPU.pc, true), z, [0, 0xed, 0xed, 1]))).toBe(ERR_FORMAT);
    loadAndCheck(cat(z80header(CPU, CPU.pc, true), z, [0, 0xed, 0xed, 0]), CPU, ram);
  });

  it("len mayor que zx_io_buffer: ZX_ERR_SIZE sin leer fuera del buffer (Z80 y SNA)", () => {
    const size = core.x.zx_io_buffer_size();
    // Un v2 válido seguido de ceros: con len enorme el bucle de bloques recorría
    // (bloques de longitud 0, página 0, ignorada) memoria más allá de zx_io.
    core.loadZ80(z80v23(CPU, makeRam(63), { ext: 23, hw: 0, compress: true }));
    for (const len of [size + 1, 0x7fffffff, 0xffffffff]) {
      expect(core.x.zx_load_z80(len), `z80 len ${len}`).toBe(ERR_SIZE);
      expect(core.x.zx_load_sna(len), `sna len ${len}`).toBe(ERR_SIZE);
    }
  });
});
