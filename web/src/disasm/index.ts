// Desensamblador Z80 (D1). TypeScript puro, sin DOM, determinista.
//
// Comparte la tabla de codificaciones con el ensamblador (../z80isa): cada patrón de bytes
// literales es único, así que basta indexar por prefijo y opcode. Lo que la tabla no
// tiene, a propósito (z80isa/index.ts, cabecera), se trata aquí:
//
// - DD/FD delante de un opcode que no usa HL/H/L/(HL) (incluidos otro DD/FD y ED): el
//   prefijo sólo cuesta 4 T y la CPU ejecuta el opcode siguiente tal cual (Young §4.1;
//   z80.c, etiqueta `index`). Se desensambla como `db 0DDh` de 1 byte; la instrucción
//   real empieza en el byte siguiente.
// - ED no asignado (00-3F, 80-9F salvo bloque, C0-FF, 77, 7F…): NOP de 8 T y 2 bytes
//   (Young §4.2; z80.c `default` de z80_ed). Se emite `db 0EDh,xxh`.
// - Codificaciones `dup` (ED 4C = neg, ED 63 = ld (nn),hl, DDCB bit con z≠6…): el
//   ensamblador siempre emite la canónica, así que para que ensamblar(desensamblar(x))
//   reproduzca los bytes se emiten como `db` con la instrucción en un comentario.
//
// Formato del texto (siempre reensamblable por ../asm): mnemónico en minúsculas
// rellenado a 5 columnas; números en hexadecimal con sufijo h y 0 delante si empiezan por
// letra (`0FFh`, `4000h`); `(ix+05h)`/`(ix-80h)`; JR/DJNZ con la dirección de destino
// absoluta, o `$+n` si el destino da la vuelta a 64 K (el ensamblador no lo admitiría).
import { OP_D, OP_E, OP_N, OP_NN, Z80_ISA, type IsaEntry, type IsaPrefix } from "../z80isa";

export type DisasmKind =
  /** Instrucción de la tabla, en su forma canónica. */
  | "insn"
  /** Codificación alternativa de la tabla: `db` + comentario con la instrucción. */
  | "dup"
  /** ED no asignado: NOP de 2 bytes. */
  | "ednop"
  /** DD/FD sin efecto: 1 byte; el opcode siguiente se ejecuta en la misma instrucción. */
  | "prefix";

export interface DisasmLine {
  addr: number;
  /** Bytes que ocupa (1..4). */
  len: number;
  bytes: number[];
  /** Texto reensamblable (puede llevar `; comentario`). */
  text: string;
  /** "ld", "call"… o "db" para dup/ednop/prefix. */
  mnemonic: string;
  /** Operandos ya formateados. */
  operands: string[];
  /** Lo que hace un `db` (dup/ednop/prefix), para mostrarlo en la UI. */
  comment: string | null;
  kind: DisasmKind;
  /** No documentada por Zilog. */
  undoc: boolean;
  /** Destino fijo de JP/JR/DJNZ/CALL/RST nn (no de JP (HL)). */
  target: number | null;
  /**
   * "Paso por encima" debe parar en addr+len: CALL, RST, DJNZ y los bloques que se
   * repiten (LDIR, LDDR, CPIR, CPDR, INIR, INDR, OTIR, OTDR).
   */
  stepOver: boolean;
}

/** Memoria de 64 K (o menos: las direcciones se reducen a 16 bits y lo que falte es 0). */
export type DisasmMemory = ArrayLike<number>;

const PREFIXES: IsaPrefix[] = ["", "cb", "ed", "dd", "fd", "ddcb", "fdcb"];
const TABLE = new Map<IsaPrefix, (IsaEntry | undefined)[]>();
for (const p of PREFIXES) TABLE.set(p, new Array<IsaEntry | undefined>(256));
for (const e of Z80_ISA) {
  const t = TABLE.get(e.prefix)!;
  if (t[e.opcode]) throw new Error(`z80isa: ${e.prefix} ${e.opcode.toString(16)} repetido`);
  t[e.opcode] = e;
}
const T = (p: IsaPrefix) => TABLE.get(p)!;

const STEP_OVER = new Set(["call", "rst", "djnz", "ldir", "lddr", "cpir", "cpdr", "inir", "indr", "otir", "otdr"]);
const BRANCH = new Set(["jp", "jr", "djnz", "call", "rst"]);
const MNEMONIC_WIDTH = 5;

/** Hexadecimal con sufijo h: `hex(255, 2)` = "0FFh", `hex(0x4000, 4)` = "4000h". */
export function hex(v: number, digits: number): string {
  const s = v.toString(16).toUpperCase().padStart(digits, "0");
  return (s.charCodeAt(0) >= 65 ? "0" : "") + s + "h";
}

function signedHex(d: number): string {
  return (d < 0 ? "-" : "+") + hex(Math.abs(d), 2);
}

const s8 = (v: number) => (v & 0x80 ? v - 256 : v);

function join(mnemonic: string, operands: readonly string[]): string {
  return operands.length ? mnemonic.padEnd(MNEMONIC_WIDTH) + operands.join(",") : mnemonic;
}

function dbText(bytes: readonly number[]): string {
  return join("db", bytes.map((b) => hex(b, 2)));
}

/** Desensambla la instrucción que empieza en `addr`. */
export function disassemble(mem: DisasmMemory, addr: number): DisasmLine {
  addr &= 0xffff;
  const rd = (i: number) => (mem[(addr + i) & 0xffff] ?? 0) & 0xff;
  const b0 = rd(0);
  let entry: IsaEntry | undefined;
  let kind: DisasmKind = "insn";
  if (b0 === 0xcb) entry = T("cb")[rd(1)];
  else if (b0 === 0xed) {
    entry = T("ed")[rd(1)];
    if (!entry) kind = "ednop";
  } else if (b0 === 0xdd || b0 === 0xfd) {
    const ix = b0 === 0xdd;
    if (rd(1) === 0xcb) entry = T(ix ? "ddcb" : "fdcb")[rd(3)];
    else {
      entry = T(ix ? "dd" : "fd")[rd(1)];
      if (!entry) kind = "prefix";
    }
  } else entry = T("")[b0];

  if (!entry) {
    const bytes = kind === "ednop" ? [b0, rd(1)] : [b0];
    const comment = kind === "ednop" ? "nop (ED no asignado)" : `prefijo ${b0 === 0xdd ? "DD" : "FD"} sin efecto`;
    return {
      addr, len: bytes.length, bytes, text: `${dbText(bytes)} ; ${comment}`, mnemonic: "db",
      operands: bytes.map((b) => hex(b, 2)), comment, kind, undoc: true, target: null, stepOver: false,
    };
  }

  const len = entry.length;
  const bytes: number[] = [];
  for (let i = 0; i < len; i++) bytes.push(rd(i));

  // Valores de los operandos según la plantilla.
  let n = 0, nn = 0, d = 0, rel = 0, relWraps = false;
  for (let i = 0, off = 0; i < entry.template.length; i++) {
    const t = entry.template[i]!;
    if (t === OP_N) n = rd(off);
    else if (t === OP_NN) { nn = rd(off) | (rd(off + 1) << 8); off++; }
    else if (t === OP_D) d = s8(rd(off));
    else if (t === OP_E) {
      const dest = addr + len + s8(rd(off));
      rel = dest & 0xffff;
      relWraps = dest !== rel;
    }
    off++;
  }
  const k = len + s8(rd(len - 1));
  const relText = relWraps ? (k < 0 ? `$-${-k}` : `$+${k}`) : hex(rel, 4);
  const operands = entry.operands.map((o) => {
    switch (o) {
      case "n": return hex(n, 2);
      case "(n)": return `(${hex(n, 2)})`;
      case "nn": return hex(nn, 4);
      case "(nn)": return `(${hex(nn, 4)})`;
      case "rel": return relText;
      case "(ix+d)": return `(ix${signedHex(d)})`;
      case "(iy+d)": return `(iy${signedHex(d)})`;
      default: return o;
    }
  });
  const m = entry.mnemonic;
  let target: number | null = null;
  if (BRANCH.has(m)) {
    if (entry.operands.includes("rel")) target = rel;
    else if (entry.operands.includes("nn")) target = nn;
    else if (m === "rst") target = parseInt(entry.operands[0]!, 16);
  }
  const insnText = join(m, operands);
  if (entry.dup) {
    return {
      addr, len, bytes, text: `${dbText(bytes)} ; ${insnText.replace(/ +/, " ")}`, mnemonic: "db",
      operands: bytes.map((b) => hex(b, 2)), comment: insnText.replace(/ +/, " "), kind: "dup",
      undoc: entry.undoc, target, stepOver: STEP_OVER.has(m),
    };
  }
  return { addr, len, bytes, text: insnText, mnemonic: m, operands, comment: null, kind, undoc: entry.undoc, target, stepOver: STEP_OVER.has(m) };
}

/** `count` instrucciones seguidas desde `addr`. */
export function disassembleRange(mem: DisasmMemory, addr: number, count: number): DisasmLine[] {
  const out: DisasmLine[] = [];
  for (let i = 0; i < count; i++) {
    const l = disassemble(mem, addr);
    out.push(l);
    addr = (addr + l.len) & 0xffff;
  }
  return out;
}
