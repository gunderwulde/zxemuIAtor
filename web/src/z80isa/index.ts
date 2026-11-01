// Tabla única del juego de instrucciones Z80 (documentadas y no documentadas).
//
// La comparten el ensamblador (A1, texto → bytes) y el desensamblador (D1, bytes → texto).
// Cada entrada es una codificación concreta: una plantilla de bytes donde los valores
// 0..255 son literales y los marcadores OP_* indican dónde van los operandos.
//
// Fuentes: Zilog "Z80 CPU User Manual" (UM0080) y Sean Young, "The Undocumented Z80
// Documented" v0.91 (tablas de opcodes CB/ED/DD/FD/DDCB). La tabla se genera con los
// campos de bits x/y/z/p/q del opcode (la misma descomposición que usa el decodificador
// del Z80), así cada fila de las tablas de opcodes sale de un único bucle legible.
//
// Lo que NO está en la tabla, a propósito (D1 lo trata aparte):
// - DD/FD delante de un opcode que no usa HL/H/L/(HL): el prefijo no tiene efecto
//   (4 T y sigue con el opcode sin prefijo).
// - ED con opcodes no asignados (00-3F, 80-9F salvo bloque, C0-FF, 77, 7F, ...): NOP de 8 T.

/** Byte inmediato (n). */
export const OP_N = 0x100;
/** Palabra inmediata (nn): ocupa dos bytes, little endian. */
export const OP_NN = 0x101;
/** Desplazamiento con signo de (IX+d)/(IY+d). */
export const OP_D = 0x102;
/** Desplazamiento relativo de JR/DJNZ, calculado respecto a la dirección siguiente. */
export const OP_E = 0x103;

export type IsaPrefix = "" | "cb" | "ed" | "dd" | "fd" | "ddcb" | "fdcb";

export interface IsaEntry {
  /** Mnemónico en minúsculas: "ld", "rlc", "sll"... */
  readonly mnemonic: string;
  /**
   * Operandos canónicos, en minúsculas, sin espacios. Marcadores: "n", "nn", "(n)", "(nn)",
   * "rel" (destino de JR/DJNZ), "(ix+d)"/"(iy+d)". Los números fijos (rst, im, bit) van literales.
   */
  readonly operands: readonly string[];
  /** Texto canónico: "ld a,(ix+d)". */
  readonly text: string;
  /** Plantilla de bytes: literales 0..255 o OP_N / OP_NN / OP_D / OP_E. */
  readonly template: readonly number[];
  /** Longitud en bytes de la instrucción (OP_NN cuenta 2). */
  readonly length: number;
  readonly prefix: IsaPrefix;
  /** Byte de opcode tras el prefijo (en DDCB/FDCB, el que va tras el desplazamiento). */
  readonly opcode: number;
  /** No documentada por Zilog. */
  readonly undoc: boolean;
  /**
   * Codificación alternativa de una instrucción que ya tiene otra canónica con el mismo
   * texto (p. ej. ED 4C = neg, ED 63 = ld (nn),hl). El ensamblador nunca la emite; el
   * desensamblador sí la reconoce.
   */
  readonly dup: boolean;
}

const R8 = ["b", "c", "d", "e", "h", "l", "(hl)", "a"];
const RP = ["bc", "de", "hl", "sp"];
const RP2 = ["bc", "de", "hl", "af"];
const CC = ["nz", "z", "nc", "c", "po", "pe", "p", "m"];
const ALU = ["add", "adc", "sub", "sbc", "and", "xor", "or", "cp"];
const ROT = ["rlc", "rrc", "rl", "rr", "sla", "sra", "sll", "srl"];
// ALU con "a," explícito en la forma canónica de Zilog.
const ALU_A = [true, true, false, true, false, false, false, false];

function hex2(v: number): string {
  return v.toString(16).padStart(2, "0") + "h";
}

function aluOps(y: number, src: string): string[] {
  return ALU_A[y] ? ["a", src] : [src];
}

function build(): IsaEntry[] {
  const out: IsaEntry[] = [];
  const add = (
    prefix: IsaPrefix,
    opcode: number,
    mnemonic: string,
    operands: string[],
    tail: number[],
    undoc = false,
    dup = false,
  ): void => {
    let template: number[];
    switch (prefix) {
      case "": template = [opcode, ...tail]; break;
      case "cb": template = [0xcb, opcode, ...tail]; break;
      case "ed": template = [0xed, opcode, ...tail]; break;
      case "dd": template = [0xdd, opcode, ...tail]; break;
      case "fd": template = [0xfd, opcode, ...tail]; break;
      case "ddcb": template = [0xdd, 0xcb, OP_D, opcode]; break;
      case "fdcb": template = [0xfd, 0xcb, OP_D, opcode]; break;
    }
    let length = 0;
    for (const t of template) length += t === OP_NN ? 2 : 1;
    const text = operands.length ? mnemonic + " " + operands.join(",") : mnemonic;
    out.push({ mnemonic, operands, text, template, length, prefix, opcode, undoc, dup });
  };

  // ---- Sin prefijo ----
  for (let op = 0; op < 256; op++) {
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    if (op === 0xcb || op === 0xdd || op === 0xed || op === 0xfd) continue;
    if (x === 0) {
      switch (z) {
        case 0:
          if (y === 0) add("", op, "nop", [], []);
          else if (y === 1) add("", op, "ex", ["af", "af'"], []);
          else if (y === 2) add("", op, "djnz", ["rel"], [OP_E]);
          else if (y === 3) add("", op, "jr", ["rel"], [OP_E]);
          else add("", op, "jr", [CC[y - 4]!, "rel"], [OP_E]);
          break;
        case 1:
          if (q === 0) add("", op, "ld", [RP[p]!, "nn"], [OP_NN]);
          else add("", op, "add", ["hl", RP[p]!], []);
          break;
        case 2: {
          const forms: [string, string, boolean][] = [
            ["(bc)", "a", false], ["(de)", "a", false], ["(nn)", "hl", true], ["(nn)", "a", true],
          ];
          const [mem, reg, imm] = forms[p]!;
          if (q === 0) add("", op, "ld", [mem, reg], imm ? [OP_NN] : []);
          else add("", op, "ld", [reg, mem], imm ? [OP_NN] : []);
          break;
        }
        case 3: add("", op, q ? "dec" : "inc", [RP[p]!], []); break;
        case 4: add("", op, "inc", [R8[y]!], []); break;
        case 5: add("", op, "dec", [R8[y]!], []); break;
        case 6: add("", op, "ld", [R8[y]!, "n"], [OP_N]); break;
        case 7: add("", op, ["rlca", "rrca", "rla", "rra", "daa", "cpl", "scf", "ccf"][y]!, [], []); break;
      }
    } else if (x === 1) {
      if (op === 0x76) add("", op, "halt", [], []);
      else add("", op, "ld", [R8[y]!, R8[z]!], []);
    } else if (x === 2) {
      add("", op, ALU[y]!, aluOps(y, R8[z]!), []);
    } else {
      switch (z) {
        case 0: add("", op, "ret", [CC[y]!], []); break;
        case 1:
          if (q === 0) add("", op, "pop", [RP2[p]!], []);
          else add("", op, ["ret", "exx", "jp", "ld"][p]!, [[], [], ["(hl)"], ["sp", "hl"]][p]!, []);
          break;
        case 2: add("", op, "jp", [CC[y]!, "nn"], [OP_NN]); break;
        case 3:
          switch (y) {
            case 0: add("", op, "jp", ["nn"], [OP_NN]); break;
            case 2: add("", op, "out", ["(n)", "a"], [OP_N]); break;
            case 3: add("", op, "in", ["a", "(n)"], [OP_N]); break;
            case 4: add("", op, "ex", ["(sp)", "hl"], []); break;
            case 5: add("", op, "ex", ["de", "hl"], []); break;
            case 6: add("", op, "di", [], []); break;
            case 7: add("", op, "ei", [], []); break;
          }
          break;
        case 4: add("", op, "call", [CC[y]!, "nn"], [OP_NN]); break;
        case 5:
          if (q === 0) add("", op, "push", [RP2[p]!], []);
          else if (p === 0) add("", op, "call", ["nn"], [OP_NN]);
          break;
        case 6: add("", op, ALU[y]!, aluOps(y, "n"), [OP_N]); break;
        case 7: add("", op, "rst", [hex2(y * 8)], []); break;
      }
    }
  }

  // ---- CB ----
  for (let op = 0; op < 256; op++) {
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
    if (x === 0) add("cb", op, ROT[y]!, [R8[z]!], [], y === 6);
    else add("cb", op, ["", "bit", "res", "set"][x]!, [String(y), R8[z]!], []);
  }

  // ---- ED ----
  for (let op = 0x40; op < 0x80; op++) {
    const y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    switch (z) {
      case 0:
        if (y === 6) add("ed", op, "in", ["f", "(c)"], [], true);
        else add("ed", op, "in", [R8[y]!, "(c)"], []);
        break;
      case 1:
        if (y === 6) add("ed", op, "out", ["(c)", "0"], [], true);
        else add("ed", op, "out", ["(c)", R8[y]!], []);
        break;
      case 2: add("ed", op, q ? "adc" : "sbc", ["hl", RP[p]!], []); break;
      case 3:
        // ED 63/6B: Zilog documenta "LD (nn),dd" para los cuatro pares, pero HL tiene
        // la forma corta 22/2A; la de ED es la alternativa.
        if (q === 0) add("ed", op, "ld", ["(nn)", RP[p]!], [OP_NN], false, p === 2);
        else add("ed", op, "ld", [RP[p]!, "(nn)"], [OP_NN], false, p === 2);
        break;
      case 4: add("ed", op, "neg", [], [], y !== 0, y !== 0); break;
      case 5:
        // Young: ED 4D es RETI; el resto de ED x5/xD se comportan como RETN.
        if (y === 1) add("ed", op, "reti", [], []);
        else add("ed", op, "retn", [], [], y !== 0, y !== 0);
        break;
      case 6: {
        // Young: IM con y=1,5 ("IM 0/1") se comporta como IM 0.
        const mode = [0, 0, 1, 2, 0, 0, 1, 2][y]!;
        const canonical = y === 0 || y === 2 || y === 3;
        add("ed", op, "im", [String(mode)], [], !canonical, !canonical);
        break;
      }
      case 7:
        if (y < 6) add("ed", op, ["ld", "ld", "ld", "ld", "rrd", "rld"][y]!,
          [["i", "a"], ["r", "a"], ["a", "i"], ["a", "r"], [], []][y]!, []);
        break;
    }
  }
  const BLOCK = [
    ["ldi", "cpi", "ini", "outi"], ["ldd", "cpd", "ind", "outd"],
    ["ldir", "cpir", "inir", "otir"], ["lddr", "cpdr", "indr", "otdr"],
  ];
  for (let y = 4; y < 8; y++) {
    for (let z = 0; z < 4; z++) add("ed", 0x80 | (y << 3) | z, BLOCK[y - 4]![z]!, [], []);
  }

  // ---- DD / FD ----
  for (const ir of ["ix", "iy"] as const) {
    const pre: IsaPrefix = ir === "ix" ? "dd" : "fd";
    const idx = `(${ir}+d)`;
    const hi = ir + "h", lo = ir + "l";
    // Sustitución de registros de 8 bits: H/L → IXH/IXL salvo si la instrucción usa (HL).
    const sub8 = (r: string): string => (r === "h" ? hi : r === "l" ? lo : r);
    const usesHL = (r: string): boolean => r === "h" || r === "l";

    add(pre, 0x09, "add", [ir, "bc"], []);
    add(pre, 0x19, "add", [ir, "de"], []);
    add(pre, 0x29, "add", [ir, ir], []);
    add(pre, 0x39, "add", [ir, "sp"], []);
    add(pre, 0x21, "ld", [ir, "nn"], [OP_NN]);
    add(pre, 0x22, "ld", ["(nn)", ir], [OP_NN]);
    add(pre, 0x2a, "ld", [ir, "(nn)"], [OP_NN]);
    add(pre, 0x23, "inc", [ir], []);
    add(pre, 0x2b, "dec", [ir], []);
    add(pre, 0x24, "inc", [hi], [], true);
    add(pre, 0x25, "dec", [hi], [], true);
    add(pre, 0x26, "ld", [hi, "n"], [OP_N], true);
    add(pre, 0x2c, "inc", [lo], [], true);
    add(pre, 0x2d, "dec", [lo], [], true);
    add(pre, 0x2e, "ld", [lo, "n"], [OP_N], true);
    add(pre, 0x34, "inc", [idx], [OP_D]);
    add(pre, 0x35, "dec", [idx], [OP_D]);
    add(pre, 0x36, "ld", [idx, "n"], [OP_D, OP_N]);

    for (let op = 0x40; op < 0x80; op++) {
      if (op === 0x76) continue;
      const y = (op >> 3) & 7, z = op & 7;
      const dst = R8[y]!, src = R8[z]!;
      if (y === 6) add(pre, op, "ld", [idx, src], [OP_D]);
      else if (z === 6) add(pre, op, "ld", [dst, idx], [OP_D]);
      else if (usesHL(dst) || usesHL(src)) add(pre, op, "ld", [sub8(dst), sub8(src)], [], true);
    }
    for (let op = 0x80; op < 0xc0; op++) {
      const y = (op >> 3) & 7, z = op & 7;
      const src = R8[z]!;
      if (z === 6) add(pre, op, ALU[y]!, aluOps(y, idx), [OP_D]);
      else if (usesHL(src)) add(pre, op, ALU[y]!, aluOps(y, sub8(src)), [], true);
    }
    add(pre, 0xe1, "pop", [ir], []);
    add(pre, 0xe5, "push", [ir], []);
    add(pre, 0xe3, "ex", ["(sp)", ir], []);
    add(pre, 0xe9, "jp", [`(${ir})`], []);
    add(pre, 0xf9, "ld", ["sp", ir], []);

    // ---- DDCB / FDCB: DD CB d op ----
    // Con z≠6 la versión no documentada escribe el resultado también en el registro z
    // (Young §4.3). BIT con z≠6 es idéntico a z=6.
    const pcb: IsaPrefix = ir === "ix" ? "ddcb" : "fdcb";
    for (let op = 0; op < 256; op++) {
      const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
      if (x === 0) {
        if (z === 6) add(pcb, op, ROT[y]!, [idx], [], y === 6);
        else add(pcb, op, ROT[y]!, [idx, R8[z]!], [], true);
      } else if (x === 1) {
        add(pcb, op, "bit", [String(y), idx], [], z !== 6, z !== 6);
      } else {
        const mn = x === 2 ? "res" : "set";
        if (z === 6) add(pcb, op, mn, [String(y), idx], []);
        else add(pcb, op, mn, [String(y), idx, R8[z]!], [], true);
      }
    }
  }
  return out;
}

/** Todas las codificaciones, en orden de prefijo y opcode. */
export const Z80_ISA: readonly IsaEntry[] = build();
