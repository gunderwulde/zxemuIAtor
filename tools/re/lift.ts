// "Lifter": de una imagen de memoria + semillas a ensamblador reensamblable.
//
// Recorrido recursivo desde las semillas (más lo que la traza vio ejecutarse) para separar
// código de datos; lo que no se alcanza sale como `db`. Los destinos de saltos y las
// referencias de 16 bits a direcciones propias reciben etiquetas; un acceso al interior de
// una instrucción (código automodificable) sale como `etiqueta+n`. El resultado se
// verifica ensamblándolo: si no reproduce los bytes, no se escribe.
import { disassemble, hex, type DisasmLine } from "../../web/src/disasm";

export interface Region {
  /** Nombre en los comentarios. */
  name: string;
  /** Bytes del tramo y dirección física (de carga). */
  bytes: Uint8Array;
  phys: number;
  /** Dirección a la que cree estar cuando se ejecuta (PHASE si ≠ phys). */
  run: number;
  /** Direcciones (lógicas) por las que empieza código. */
  seeds: number[];
  /** Inicios de instrucción vistos en la traza (lógicos). */
  traced?: number[];
  /** Prefijo de las etiquetas automáticas (para tramos PHASE cuyas direcciones lógicas se repiten). */
  prefix?: string;
}

export interface Names {
  /** Dirección lógica → nombre de etiqueta (sustituye al automático). */
  labels?: Record<number, string>;
  /** Dirección lógica → comentario de línea que se pone encima. */
  comments?: Record<number, string>;
  /** Direcciones de datos que son tablas de palabras (dw): dirección → nº de palabras. */
  words?: Record<number, number>;
  /** Cadenas de texto: dirección → longitud. */
  strings?: Record<number, number>;
  /** Fuerza una dirección (lógica) a ser código aunque nadie la alcance. */
  code?: number[];
}

/** ROM del 48K: rutinas que usa el juego. */
export const ROM_NAMES: Record<number, string> = {
  0x0000: "rom_start", 0x0008: "rom_error", 0x0010: "rom_print_a", 0x0018: "rom_get_char", 0x0020: "rom_next_char",
  0x0028: "rom_calc", 0x0030: "rom_bc_spaces", 0x0038: "rom_mask_int", 0x028e: "rom_key_scan", 0x031e: "rom_key_test",
  0x03b5: "rom_beeper", 0x0556: "rom_ld_bytes", 0x0562: "rom_ld_break", 0x04c2: "rom_sa_bytes", 0x09f4: "rom_print_out",
  0x0d6b: "rom_cls", 0x0daf: "rom_cl_all", 0x0e44: "rom_cl_line", 0x0ecd: "rom_cl_scr", 0x1601: "rom_chan_open",
  0x15e6: "rom_input_ad", 0x203c: "rom_print_str", 0x22aa: "rom_pixel_addr", 0x22e5: "rom_plot", 0x24b7: "rom_draw",
  0x2d2b: "rom_stack_bc", 0x2da2: "rom_fp_to_bc", 0x3d00: "rom_charset", 0x3c00: "rom_charset_base",
};
export const SYSVARS: Record<number, string> = {
  0x5c3b: "FLAGS", 0x5c3c: "TV_FLAG", 0x5c3d: "ERR_SP", 0x5c48: "BORDCR", 0x5c4a: "E_PPC", 0x5c51: "CURCHL",
  0x5c5c: "FLAGS2", 0x5c6a: "FLAGS2b", 0x5c6b: "DF_SZ", 0x5c78: "FRAMES", 0x5c8d: "ATTR_P", 0x5c8f: "ATTR_T",
  0x5c8e: "ATTR_Pb", 0x5c91: "P_FLAG", 0x5c37: "ERR_NR_mark", 0x5c08: "LAST_K", 0x5c00: "KSTATE", 0x5c36: "CHARS",
  0x5c38: "RASP", 0x5c39: "PIP", 0x5cb2: "RAMTOP",
};

interface Insn { line: DisasmLine; /** Dirección lógica. */ a: number }

const jmpAlways = (l: DisasmLine) => (l.mnemonic === "jp" && l.operands.length === 1) || (l.mnemonic === "jr" && l.operands.length === 1);
const isRet = (l: DisasmLine) => (l.mnemonic === "ret" && l.operands.length === 0) || l.mnemonic === "reti" || l.mnemonic === "retn";
const stops = (l: DisasmLine) =>
  jmpAlways(l) || isRet(l) || (l.mnemonic === "jp" && /^\((hl|ix|iy)\)$/.test(l.operands[0] ?? "")) ||
  (l.mnemonic === "rst" && false);

/** ¿La instrucción lleva una dirección nn de 16 bits como operando? Devuelve su valor. */
function nnOperand(l: DisasmLine): number | null {
  if (l.len < 3) return null;
  const v = l.bytes[l.len - 2]! | (l.bytes[l.len - 1]! << 8);
  const tok = hex(v, 4);
  return l.text.includes(tok) ? v : null;
}

export interface LiftResult {
  text: string;
  /** Bytes que quedaron como código / datos, para las estadísticas. */
  codeBytes: number;
  dataBytes: number;
  labels: Map<number, string>;
  /** Nombres externos (ROM, variables del sistema) que usa: hay que definirlos con EQU. */
  externs: Map<number, string>;
  /** Tramos consecutivos de código o de datos (direcciones lógicas). */
  layout: Array<{ kind: "code" | "data"; a: number; n: number }>;
}

export function lift(r: Region, names: Names = {}, externalLabels: Map<number, string> = new Map()): LiftResult {
  const base = r.run, len = r.bytes.length, end = base + len; // [base, end)
  const mem = new Uint8Array(65536 + 8);
  mem.set(r.bytes, base);
  const inside = (a: number) => a >= base && a < end;

  // 1) Recorrido recursivo.
  const insns = new Map<number, Insn>();
  const owner = new Int32Array(len).fill(-1); // byte → inicio de la instrucción que lo cubre
  const work = [...r.seeds, ...(r.traced ?? []), ...(names.code ?? [])].filter(inside);
  const targets = new Map<number, "call" | "jump">();
  while (work.length) {
    const a = work.pop()!;
    if (!inside(a) || insns.has(a) || owner[a - base]! >= 0) continue;
    const l = disassemble(mem, a);
    if (a + l.len > end) continue;
    let clash = false;
    for (let k = 0; k < l.len; k++) if (owner[a - base + k]! >= 0) clash = true;
    if (clash) continue;
    insns.set(a, { line: l, a });
    for (let k = 0; k < l.len; k++) owner[a - base + k] = a;
    if (l.target !== null) {
      if (inside(l.target)) {
        if (!targets.has(l.target) || l.mnemonic === "call") targets.set(l.target, l.mnemonic === "call" || l.mnemonic === "rst" ? "call" : "jump");
        work.push(l.target);
      }
    }
    if (!stops(l)) work.push(a + l.len);
  }

  // 1b) Textos: `ld de,txt` + `ld bc,len` + `call PRINT-STRING (203Ch)`. Lo que imprime la ROM
  // es texto (con códigos de control), no instrucciones.
  {
    const order = [...insns.keys()].sort((x, y) => x - y);
    let de = -1, bc = -1;
    for (const a of order) {
      const l = insns.get(a)!.line;
      const imm = l.len === 3 ? l.bytes[1]! | (l.bytes[2]! << 8) : -1;
      if (l.mnemonic === "ld" && l.operands[0] === "de" && imm >= 0 && l.bytes[0] === 0x11) de = imm;
      else if (l.mnemonic === "ld" && l.operands[0] === "bc" && imm >= 0 && l.bytes[0] === 0x01) bc = imm;
      else if (l.mnemonic === "call" && l.target === 0x203c && de >= 0 && bc > 0 && inside(de) && !insns.has(de)) {
        names.strings = { ...(names.strings ?? {}), [de]: bc };
        de = bc = -1;
      } else if (stops(l) || l.mnemonic === "call" || l.mnemonic === "djnz" || l.mnemonic === "jr") { de = bc = -1; }
    }
  }

  // 2) Referencias de datos: nn que cae dentro del tramo.
  const refs = new Map<number, true>();
  for (const { line } of insns.values()) {
    const v = nnOperand(line);
    if (v !== null && inside(v) && line.target === null) refs.set(v, true);
  }

  // 3) Etiquetas. Un destino/referencia al interior de una instrucción se expresa como etiqueta+n.
  const labels = new Map<number, string>();
  const nameFor = (a: number, kind: "call" | "jump" | "data") => {
    const custom = names.labels?.[a];
    if (custom) return custom;
    const p = kind === "call" ? "sub" : kind === "jump" ? "lbl" : "dat";
    return `${r.prefix ?? ""}${p}_${a.toString(16).toUpperCase().padStart(4, "0")}`;
  };
  const wantLabel = (a: number, kind: "call" | "jump" | "data") => {
    if (!inside(a)) return;
    const o = owner[a - base]!;
    const at = o >= 0 ? o : a;   // al interior de una instrucción: etiqueta en su inicio
    if (!labels.has(at)) labels.set(at, nameFor(at, o >= 0 && at !== a ? "jump" : kind));
  };
  wantLabel(r.run, "jump");
  for (const [a, k] of targets) wantLabel(a, k);
  for (const a of refs.keys()) wantLabel(a, insns.has(a) ? "jump" : "data");
  for (const a of r.seeds) wantLabel(a, "call");
  for (const a of Object.keys(names.labels ?? {})) wantLabel(+a, "data");
  for (const a of Object.keys(names.words ?? {})) wantLabel(+a, "data");
  for (const a of Object.keys(names.strings ?? {})) wantLabel(+a, "data");
  const externs = new Map<number, string>();
  const lookup = (a: number): string | null => {
    if (!inside(a)) {
      const n = externalLabels.get(a) ?? ROM_NAMES[a] ?? SYSVARS[a] ?? null;
      if (n) externs.set(a, n);
      return n;
    }
    const o = owner[a - base]!;
    const at = o >= 0 ? o : a;
    const nm = labels.get(at);
    if (!nm) return null;
    return at === a ? nm : `${nm}+${a - at}`;
  };

  // 4) Emisión.
  const out: string[] = [];
  let codeBytes = 0, dataBytes = 0;
  const layout: LiftResult["layout"] = [];
  const addLayout = (kind: "code" | "data", a: number, n: number) => {
    const last = layout[layout.length - 1];
    if (last && last.kind === kind && last.a + last.n === a) last.n += n;
    else layout.push({ kind, a, n });
  };
  const label = (a: number) => { const n = labels.get(a); return n ? `${n}:` : ""; };
  const comment = (a: number) => { const c = names.comments?.[a]; if (c) for (const t of c.split("\n")) out.push(`; ${t}`); };
  const rowDb = (a: number, n: number): string => {
    const bs = Array.from(r.bytes.subarray(a - base, a - base + n));
    return ` db ${bs.map((b) => hex(b, 2)).join(",")}`;
  };
  const replaceTok = (text: string, v: number, name: string) => text.split(hex(v, 4)).join(name);

  const physOf = (a: number) => r.phys + (a - base);
  if (r.run !== r.phys) out.push(` org ${hex(r.phys, 4)}`, ` phase ${hex(r.run, 4)}`);
  else out.push(` org ${hex(r.phys, 4)}`);
  let a = base;
  while (a < end) {
    comment(a);
    const ins = insns.get(a);
    if (ins) {
      const l = ins.line;
      let text = l.text;
      if (l.kind === "insn") {
        if (l.target !== null) { const nm = lookup(l.target); if (nm) text = replaceTok(text, l.target, nm); }
        else {
          const v = nnOperand(l);
          if (v !== null) { const nm = lookup(v); if (nm) text = replaceTok(text, v, nm); }
        }
      }
      const lab = label(a);
      out.push(`${(lab || "").padEnd(12)}${text.replace(/^\s+/, "")}`);
      codeBytes += l.len;
      addLayout("code", a, l.len);
      a += l.len;
      continue;
    }
    // Datos: hasta la siguiente instrucción o etiqueta.
    let n = 1;
    while (a + n < end && !insns.has(a + n) && !labels.has(a + n) && !names.comments?.[a + n]) n++;
    const lab = label(a);
    if (lab) out.push(lab);
    dataBytes += n;
    addLayout("data", a, n);
    const wordsN = names.words?.[a];
    let p = a;
    if (wordsN !== undefined) {
      const stop = Math.min(a + wordsN * 2, a + n);
      while (p + 1 < stop) {
        const w = r.bytes[p - base]! | (r.bytes[p - base + 1]! << 8);
        const nm = lookup(w);
        out.push(` dw ${nm ?? hex(w, 4)}`);
        p += 2;
      }
    }
    const strLen = names.strings?.[a];
    if (strLen !== undefined && p === a) {
      const bs = Array.from(r.bytes.subarray(a - base, a - base + Math.min(strLen, n)));
      out.push(...strRows(bs));
      p += bs.length;
    }
    while (p < a + n) {
      const left = a + n - p;
      // Tramos largos de un mismo byte (relleno): DS.
      let same = 1;
      while (same < left && r.bytes[p - base + same] === r.bytes[p - base]) same++;
      if (same >= 16) {
        const v = r.bytes[p - base]!;
        out.push(v === 0 ? ` ds ${same}` : ` ds ${same},${hex(v, 2)}`);
        p += same;
        continue;
      }
      const row = Math.min(left, 16, same >= 8 ? same : 16);
      out.push(rowDb(p, row));
      p += row;
    }
    a += n;
  }
  if (r.run !== r.phys) out.push(" dephase");
  void physOf;
  return { text: out.join("\n") + "\n", codeBytes, dataBytes, labels, externs, layout };
}

/** Texto: db "…" con los tramos imprimibles y números para el resto. */
function strRows(bs: number[]): string[] {
  const rows: string[] = [];
  let cur: string[] = [];
  let q = "";
  const flushQ = () => { if (q) { cur.push(`"${q}"`); q = ""; } };
  for (const b of bs) {
    if (b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c) q += String.fromCharCode(b);
    else { flushQ(); cur.push(hex(b, 2)); }
    if (cur.length + (q ? 1 : 0) >= 12) { flushQ(); rows.push(` db ${cur.join(",")}`); cur = []; }
  }
  flushQ();
  if (cur.length) rows.push(` db ${cur.join(",")}`);
  return rows;
}
