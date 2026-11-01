// Arnés de L1: programas en ensamblador que llaman a la librería con la convención de
// docs/c-abi.md §3 (argumentos apilados de derecha a izquierda, el llamador limpia,
// retorno en HL) y se ejecutan en el núcleo real (core-probe = máquina 48K + hooks).
import { assemble } from "../../web/src/asm";
import { clibResolve } from "../../web/src/clib";
import { assembleAndRun } from "../../web/src/ui/run";
import { Probe } from "../util/probe";
import { KEY } from "../util/keys";

export const LIB_ASM = ["zxgfx.asm", "zxtext.asm", "zxinput.asm", "zxsound.asm", "zxint.asm", "string.asm", "stdlib.asm"];

/** Llamada C: `ld hl,arg / push hl` de derecha a izquierda, `call _f`, `pop de` × n. */
export function call(name: string, ...args: (number | string)[]): string {
  const out: string[] = [];
  for (let i = args.length - 1; i >= 0; i--) out.push(`        ld hl,${args[i]}`, "        push hl");
  out.push(`        call _${name}`);
  for (let i = 0; i < args.length; i++) out.push("        pop de");
  return out.join("\n");
}
/** Guarda HL en res+2k. */
export const keep = (k: number) => `        ld (res+${2 * k}),hl`;

export const IX_SENTINEL = 0xa55a;

/** Programa completo: IX centinela, cuerpo, copia IX/IY y bucle final en `fin`. */
export function program(body: string, data = ""): string {
  return [
    "        org 8000h",
    // El bitmap se borra a mano (no con la librería): tras el arranque la ROM deja el
    // mensaje de copyright en la fila 23.
    "start:  ld hl,4000h",
    "        ld de,4001h",
    "        ld bc,6143",
    "        ld (hl),0",
    "        ldir",
    `        ld ix,${IX_SENTINEL}`,
    body,
    "        ld (ix_out),ix",
    "        ld (iy_out),iy",
    "fin:    jr fin",
    "ix_out: dw 0",
    "iy_out: dw 0",
    "res:    ds 64",
    data,
    ...LIB_ASM.map((f) => `        include ${f}`),
    "        end start",
  ].join("\n");
}

export interface Run {
  p: Probe;
  sym(name: string): number;
  res(k: number): number;
  ram(): Uint8Array;
  peek16(a: number): number;
  frames(n: number): void;
  untilFin(maxFrames?: number): void;
  atFin(): boolean;
}

export async function booted(): Promise<Probe> {
  const p = await Probe.create();
  for (let i = 0; i < 150; i++) p.runFrame();
  return p;
}

/** Ensambla, inyecta (I1) y corre hasta `fin` (salvo `run: false`). */
export async function run(src: string, opts: { run?: boolean; maxFrames?: number; p?: Probe } = {}): Promise<Run> {
  const p = opts.p ?? (await booted());
  const rep = assembleAndRun(p, src, { include: (path) => clibResolve(path) });
  const errs = rep.asm.errors;
  if (!rep.ok || errs.length) throw new Error("no ensambla:\n" + errs.map((e) => `${e.file ?? ""}:${e.line}:${e.col} ${e.msg}`).join("\n") + JSON.stringify(rep.messages));
  const syms = rep.asm.symbols;
  const r: Run = {
    p,
    sym(name) {
      const v = syms.get(name);
      if (v === undefined) throw new Error(`símbolo ${name}`);
      return v;
    },
    ram: () => p.ram(),
    peek16: (a) => p.ram()[a]! | (p.ram()[(a + 1) & 0xffff]! << 8),
    res: (k) => r.peek16(r.sym("res") + 2 * k),
    frames(n) { for (let i = 0; i < n; i++) p.runFrame(); },
    atFin: () => p.regs.get16("pc") === r.sym("fin"),
    untilFin(maxFrames = 50) {
      for (let f = 0; f < maxFrames && !r.atFin(); f++) p.runFrame();
      if (!r.atFin()) throw new Error(`no llega a fin (PC=${p.regs.get16("pc").toString(16)})`);
    },
  };
  if (opts.run !== false) r.untilFin(opts.maxFrames);
  return r;
}

/** Tamaño en bytes de la librería ensamblada sola. */
export function libSize(files = LIB_ASM): number {
  const a = assemble(["org 8000h", ...files.map((f) => `include ${f}`)].join("\n"), { include: (p) => clibResolve(p) });
  if (a.errors.length) throw new Error(JSON.stringify(a.errors));
  return a.segments.reduce((n, s) => n + s.bytes.length, 0);
}

export function hold(p: Probe, keys: string[], down: boolean) {
  for (const k of keys) p.x.zx_key(KEY[k]![0], KEY[k]![1], down ? 1 : 0);
}

/** Byte del bitmap para (x en píxeles, y): docs/zx48-hardware.md §3 (fórmula, no la librería). */
export const pix = (x: number, y: number) => 0x4000 | ((y & 0xc0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2) | (x >> 3);
