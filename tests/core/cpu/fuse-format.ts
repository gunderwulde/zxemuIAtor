// Parser del formato de los tests de la CPU de Fuse (tests.in / tests.expected).
//
// tests.in, por caso:
//   nombre
//   AF BC DE HL AF' BC' DE' HL' IX IY SP PC MEMPTR      (13 palabras hex)
//   I R IFF1 IFF2 IM halted tstates                    (tstates en decimal)
//   addr b0 b1 ... -1                                   (0..n bloques de memoria)
//   -1
// tests.expected, por caso:
//   nombre
//   "    t TIPO addr [valor]"                            (eventos de bus, indentados)
//   13 palabras de registros
//   I R IFF1 IFF2 IM halted tstates
//   addr b0 b1 ... -1                                   (memoria modificada)
//   (línea en blanco)

export const REG16_ORDER = ["af", "bc", "de", "hl", "af_", "bc_", "de_", "hl_", "ix", "iy", "sp", "pc", "memptr"] as const;
export type FuseReg16 = (typeof REG16_ORDER)[number];

export interface FuseState {
  regs: Record<FuseReg16, number>;
  i: number;
  r: number;
  iff1: number;
  iff2: number;
  im: number;
  halted: number;
  tstates: number;
}

export interface MemBlock {
  addr: number;
  bytes: number[];
}

export interface FuseInput {
  name: string;
  state: FuseState;
  mem: MemBlock[];
}

export interface FuseExpected {
  name: string;
  events: string[]; // normalizados con formatEvent
  state: FuseState;
  mem: MemBlock[];
}

const EVENT_KINDS = ["MC", "MR", "MW", "PR", "PW", "PC"] as const;

/** Formato canónico de un evento, igual para el fichero y para el log del wasm. */
export function formatEvent(t: number, kind: number, addr: number, value: number): string {
  const k = EVENT_KINDS[kind] ?? `?${kind}`;
  const a = addr.toString(16).padStart(4, "0");
  const hasValue = k !== "MC" && k !== "PC";
  return `${String(t).padStart(5)} ${k} ${a}${hasValue ? " " + value.toString(16).padStart(2, "0") : ""}`;
}

function lines(text: string): string[] {
  return text.replace(/\r/g, "").split("\n");
}

function parseState(regLine: string, miscLine: string): FuseState {
  const w = regLine.trim().split(/\s+/).map((x) => parseInt(x, 16));
  if (w.length !== 13 || w.some(Number.isNaN)) throw new Error(`línea de registros inválida: "${regLine}"`);
  const m = miscLine.trim().split(/\s+/);
  if (m.length !== 7) throw new Error(`línea I R IFF… inválida: "${miscLine}"`);
  const regs = {} as Record<FuseReg16, number>;
  REG16_ORDER.forEach((r, i) => (regs[r] = w[i]!));
  return {
    regs,
    i: parseInt(m[0]!, 16),
    r: parseInt(m[1]!, 16),
    iff1: parseInt(m[2]!, 10),
    iff2: parseInt(m[3]!, 10),
    im: parseInt(m[4]!, 10),
    halted: parseInt(m[5]!, 10),
    tstates: parseInt(m[6]!, 10),
  };
}

function parseMemLine(line: string): MemBlock {
  const w = line.trim().split(/\s+/);
  if (w[w.length - 1] !== "-1") throw new Error(`bloque de memoria sin -1: "${line}"`);
  return { addr: parseInt(w[0]!, 16), bytes: w.slice(1, -1).map((x) => parseInt(x, 16)) };
}

export function parseFuseIn(text: string): FuseInput[] {
  const ls = lines(text);
  const out: FuseInput[] = [];
  let i = 0;
  while (i < ls.length) {
    if (ls[i]!.trim() === "") { i++; continue; }
    const name = ls[i++]!.trim();
    const state = parseState(ls[i++]!, ls[i++]!);
    const mem: MemBlock[] = [];
    while (ls[i]!.trim() !== "-1") mem.push(parseMemLine(ls[i++]!));
    i++; // -1 final
    out.push({ name, state, mem });
  }
  return out;
}

export function parseFuseExpected(text: string): FuseExpected[] {
  const ls = lines(text);
  const out: FuseExpected[] = [];
  let i = 0;
  while (i < ls.length) {
    if (ls[i]!.trim() === "") { i++; continue; }
    const name = ls[i++]!.trim();
    const events: string[] = [];
    while (/^\s/.test(ls[i]!)) {
      const w = ls[i++]!.trim().split(/\s+/);
      const kind = EVENT_KINDS.indexOf(w[1] as (typeof EVENT_KINDS)[number]);
      if (kind < 0) throw new Error(`${name}: evento desconocido "${ls[i - 1]}"`);
      events.push(formatEvent(parseInt(w[0]!, 10), kind, parseInt(w[2]!, 16), w[3] ? parseInt(w[3], 16) : 0));
    }
    const state = parseState(ls[i++]!, ls[i++]!);
    const mem: MemBlock[] = [];
    while (i < ls.length && ls[i]!.trim() !== "") mem.push(parseMemLine(ls[i++]!));
    out.push({ name, events, state, mem });
  }
  return out;
}
