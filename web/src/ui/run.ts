// I1: "Ensamblar y ejecutar". Inyecta el programa en la RAM del emulador y salta a su
// entrada de forma que un RET vuelva al editor de BASIC. Puro (sin DOM): lo usan la UI y
// los tests contra el núcleo real.
//
// PUNTO SEGURO (ROM 48K, The Complete Spectrum ROM Disassembly, Logan & O'Hara; bytes
// comprobados en rom/48.rom):
//
//   0F38 ED-LOOP    CALL 15D4 (WAIT-KEY)      ; el editor espera una tecla; vuelve a 0F3B
//   15D4 WAIT-KEY   BIT 5,(IY+02h) ; JR NZ,15DE ; SET 3,(IY+02h)
//   15DE WAIT-KEY1  CALL 15E6 (INPUT-AD) ; RET C ; JR Z,15DE
//   15E6 INPUT-AD   EXX ; PUSH HL ; LD HL,(CURCHL) ; INC HL ; INC HL ; JR CALL-SUB
//
// Mientras el editor espera una tecla la ROM da vueltas en WAIT-KEY1. En PC = 15DE con
// [SP] = 0F3B (la vuelta a ED-LOOP) no hay ningún registro vivo salvo IY y SP: A y F los
// reescribe INPUT-AD, y H'L' lo guarda y repone INPUT-AD. Es el único punto en que el
// editor está quieto y su estado cabe en la pila, así que ahí se "llama" al programa.
//
// RETORNO: un PUSH PC desnudo (volver a 15DE) no basta. INPUT-AD lee la rutina de
// entrada del canal ACTUAL (CURCHL); un programa que abre otro canal (hola mundo hace
// CALL 1601h con A=2, canal S) volvería a la entrada del canal S, que es 15C4 REPORT-J
// (RST 8 / DB 12h) → "J Invalid I/O device". Por eso la dirección que se apila no es 15DE
// sino un trampolín de 18 bytes escrito justo debajo de la pila, que deja la máquina
// como MAIN-2 (12AC: LD A,0 / CALL CHAN-OPEN) antes de entrar en el editor:
//
//   LD IY,5C3Ah     ; base de las variables del sistema (la ROM la da por fija)
//   IM 1            ; el editor lee el teclado en la INT de IM 1 (KEYBOARD, 02BF)
//   XOR A
//   CALL 1601h      ; CHAN-OPEN con el stream 0 = canal K, como MAIN-2
//   LD SP,sp0       ; descarta el trampolín: la pila queda como estaba en el punto seguro
//   EI
//   JP 15D4h        ; WAIT-KEY desde el principio: la propia ROM decide si marca
//                   ; TV_FLAG bit 3 para que KEY-INPUT redibuje la línea de edición
//
// El trampolín vive en [sp0-18, sp0): el CALL a CHAN-OPEN apila por debajo de él y
// LD SP lo descarta antes del salto, así que no deja rastro.

import { assemble, type AsmError, type AsmOptions, type AsmResult, type AsmSegment } from "../asm";
import { TSTATES_PER_FRAME } from "../emu/core";

export const SAFE_PC = 0x15de;       // WAIT-KEY1
export const ED_LOOP_RET = 0x0f3b;   // vuelta de CALL WAIT-KEY en ED-LOOP
export const WAIT_KEY = 0x15d4;
export const CHAN_OPEN = 0x1601;

// Variables del sistema (manual del 48K, cap. 25).
export const SYSVARS_START = 0x5c00;
export const SYSVARS_END = 0x5cb6;   // exclusivo: la última es P_RAMT (5CB4h, 2 bytes)
const CHANS = 0x5c4f;
const STKEND = 0x5c65;
const RAMTOP = 0x5cb2;

/** Margen bajo la pila para lo que el trampolín y las rutinas de la ROM apilan. */
const STACK_MARGIN = 32;
/** Presupuesto para encontrar el punto seguro con la máquina en marcha (2 frames). */
const SEEK_T = 2 * TSTATES_PER_FRAME;
/** Frames como máximo para arrancar la ROM tras un reset (arranca en ~90). */
const BOOT_FRAMES = 400;

/** Lo que run.ts necesita del núcleo (Core de web/src/emu/core.ts lo cumple). */
export interface RunCore {
  x: {
    zx_step(): number;
    zx_reset(): void;
    zx_tstate(): number;
    zx_frame_count(): number;
    zx_poke(addr: number, v: number): void;
    zx_set_pc(addr: number): void;
  };
  regs: { get16(r: "sp" | "pc"): number; set16(r: "sp", v: number): void };
  ram(): Uint8Array;
  runFrame(): number;
}

export interface RunMessage { severity: "error" | "warning" | "info"; text: string }

export interface RunReport {
  asm: AsmResult;
  /** El programa se ha inyectado y el PC apunta a su entrada. */
  ok: boolean;
  /** Hubo que reiniciar la máquina porque no estaba en el editor de BASIC. */
  reset: boolean;
  messages: RunMessage[];
}

const hex4 = (x: number) => x.toString(16).toUpperCase().padStart(4, "0") + "h";

function peek16(ram: Uint8Array, a: number): number {
  return ram[a & 0xffff]! | (ram[(a + 1) & 0xffff]! << 8);
}

function totalT(core: RunCore): number {
  return core.x.zx_frame_count() * TSTATES_PER_FRAME + core.x.zx_tstate();
}

export function atSafePoint(core: RunCore): boolean {
  return core.regs.get16("pc") === SAFE_PC && peek16(core.ram(), core.regs.get16("sp")) === ED_LOOP_RET;
}

/**
 * Ejecuta instrucciones (zx_step: sin breakpoints) hasta el punto seguro, como mucho
 * `budget` T. Devuelve si lo ha alcanzado.
 */
export function seekSafePoint(core: RunCore, budget = SEEK_T): boolean {
  const end = totalT(core) + budget;
  while (!atSafePoint(core)) {
    if (totalT(core) >= end) return false;
    core.x.zx_step();
  }
  return true;
}

/** Reinicia y deja correr la ROM hasta que el editor espera una tecla. */
export function bootToEditor(core: RunCore): boolean {
  core.x.zx_reset();
  for (let f = 0; f < BOOT_FRAMES; f++) {
    core.runFrame();
    // La vuelta de WAIT-KEY1 dura ~100 T: si el editor ya espera, se ve enseguida.
    if (seekSafePoint(core, 2000)) return true;
  }
  return false;
}

/** Bytes del trampolín de retorno (ver cabecera) para una pila sp0. */
export function trampoline(sp0: number): number[] {
  return [
    0xfd, 0x21, 0x3a, 0x5c,                 // LD IY,5C3Ah
    0xed, 0x56,                             // IM 1
    0xaf,                                   // XOR A
    0xcd, CHAN_OPEN & 0xff, CHAN_OPEN >> 8, // CALL CHAN-OPEN
    0x31, sp0 & 0xff, (sp0 >> 8) & 0xff,    // LD SP,sp0
    0xfb,                                   // EI
    0xc3, WAIT_KEY & 0xff, WAIT_KEY >> 8,   // JP WAIT-KEY
  ];
}
export const TRAMPOLINE_LEN = trampoline(0).length;

function overlaps(s: AsmSegment, lo: number, hi: number): [number, number] | null {
  const a = Math.max(s.addr, lo), b = Math.min(s.addr + s.bytes.length, hi);
  return a < b ? [a, b - 1] : null;
}

/**
 * Comprueba los segmentos contra el estado actual de la máquina (debe estar en el punto
 * seguro para que la pila y las variables tengan sentido). Errores: ROM. Avisos:
 * variables del sistema, área de BASIC (canales, programa, línea de edición, pila del
 * calculador: CHANS..STKEND) y pila de la máquina (SP − trampolín − margen .. RAMTOP).
 * La pantalla (4000h–5AFFh), el búfer de impresora y los UDG se pueden escribir.
 */
export function checkSegments(segments: readonly AsmSegment[], ram: Uint8Array, sp: number): RunMessage[] {
  const out: RunMessage[] = [];
  const zones: [number, number, string][] = [
    [SYSVARS_START, SYSVARS_END, "las variables del sistema (5C00h–5CB5h)"],
    [peek16(ram, CHANS), peek16(ram, STKEND), "el área de BASIC (canales, programa y línea de edición)"],
    [sp - TRAMPOLINE_LEN - 2 - STACK_MARGIN, peek16(ram, RAMTOP) + 1, "la pila de la máquina"],
  ];
  for (const s of segments) {
    const end = s.addr + s.bytes.length - 1;
    if (s.addr < 0x4000) {
      out.push({ severity: "error", text: `El segmento ${hex4(s.addr)}–${hex4(end)} cae en la ROM (0000h–3FFFh), que no se puede escribir. Usa un ORG ≥ 4000h (p. ej. ORG 8000h).` });
      continue;
    }
    for (const [lo, hi, what] of zones) {
      const o = lo < hi ? overlaps(s, lo, hi) : null;
      if (o) out.push({ severity: "warning", text: `${hex4(o[0])}–${hex4(o[1])} pisa ${what}: la vuelta a BASIC puede fallar.` });
    }
  }
  return out;
}

/**
 * Inyecta en el punto seguro: trampolín bajo la pila, su dirección apilada (el RET del
 * programa salta a él), segmentos con zx_poke (el núcleo pone al día el vídeo si tocan
 * la pantalla) y PC = entrada. Los segmentos se escriben después del trampolín: si el
 * usuario pisa la pila a propósito, sus bytes ganan (ya se le ha avisado).
 */
export function inject(core: RunCore, segments: readonly AsmSegment[], entry: number): void {
  const sp0 = core.regs.get16("sp");
  const base = (sp0 - TRAMPOLINE_LEN) & 0xffff;
  const code = trampoline(sp0);
  for (let i = 0; i < code.length; i++) core.x.zx_poke((base + i) & 0xffff, code[i]!);
  const sp = (base - 2) & 0xffff;
  core.x.zx_poke(sp, base & 0xff);
  core.x.zx_poke((sp + 1) & 0xffff, base >> 8);
  core.regs.set16("sp", sp);
  for (const s of segments) for (let i = 0; i < s.bytes.length; i++) core.x.zx_poke(s.addr + i, s.bytes[i]!);
  core.x.zx_set_pc(entry & 0xffff);
}

function asmMessages(errors: readonly AsmError[]): RunMessage[] {
  return errors.map((e) => ({
    severity: e.severity,
    text: `${e.file ? e.file + ":" : ""}${e.line}:${e.col}: ${e.severity === "error" ? "error" : "aviso"}: ${e.msg}`,
  }));
}

/**
 * Ensambla y ejecuta. Si la máquina no está en el editor de BASIC (programa colgado,
 * juego cargado, parada en un breakpoint de un programa anterior…) se reinicia y se
 * espera a que la ROM arranque; el informe lo dice (`reset`). Pausa: esta función no
 * sabe nada del bucle; la UI reanuda después ("ejecutar" significa correr).
 */
export function assembleAndRun(core: RunCore, source: string, opts: AsmOptions = {}): RunReport {
  const asm = assemble(source, opts);
  const messages = asmMessages(asm.errors);
  const nErr = asm.errors.filter((e) => e.severity === "error").length;
  const nWarn = asm.errors.length - nErr;
  if (nErr > 0) {
    messages.push({ severity: "error", text: `${nErr} error${nErr === 1 ? "" : "es"}: no se ejecuta nada.` });
    return { asm, ok: false, reset: false, messages };
  }
  const bytes = asm.segments.reduce((n, s) => n + s.bytes.length, 0);
  if (bytes === 0) {
    messages.push({ severity: "error", text: "El programa no genera ningún byte." });
    return { asm, ok: false, reset: false, messages };
  }
  // Errores que no dependen del estado de la máquina, antes de tocarla.
  const romErr = checkSegments(asm.segments, core.ram(), 0).filter((m) => m.severity === "error");
  if (romErr.length > 0) return { asm, ok: false, reset: false, messages: [...messages, ...romErr] };

  let reset = false;
  if (!seekSafePoint(core)) {
    reset = true;
    messages.push({ severity: "info", text: `La máquina no estaba esperando una tecla en el editor de BASIC (PC=${hex4(core.regs.get16("pc"))}): se reinicia.` });
    if (!bootToEditor(core)) {
      messages.push({ severity: "error", text: "La ROM no ha llegado al editor de BASIC tras el reinicio." });
      return { asm, ok: false, reset, messages };
    }
  }
  messages.push(...checkSegments(asm.segments, core.ram(), core.regs.get16("sp")));
  inject(core, asm.segments, asm.entry);
  const ranges = asm.segments.map((s) => `${hex4(s.addr)}–${hex4(s.addr + s.bytes.length - 1)}`).join(", ");
  messages.push({
    severity: "info",
    text: `Ensamblado sin errores${nWarn ? ` (${nWarn} aviso${nWarn === 1 ? "" : "s"})` : ""}: ${bytes} bytes en ${ranges}. Ejecutando desde ${hex4(asm.entry)}; RET vuelve a BASIC.`,
  });
  return { asm, ok: true, reset, messages };
}
