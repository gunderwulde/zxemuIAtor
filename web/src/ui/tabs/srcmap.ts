// U1: mapa dirección ↔ (pestaña, línea) del último programa construido. Puro (sin DOM).
//
// Ensamblador: el lineMap de A1 da {addr, line, len, file?} por sentencia; file sólo en
// los INCLUDE (= otra pestaña).
//
// C: el compilador (K1, docs/c-abi.md §8) devuelve cLineMap = {file, line, asmLine}: la
// línea del ensamblador generado (1-based) en la que empieza el código de cada sentencia C
// (es un comentario "; main.c:9: …"). El código de esa sentencia son las líneas que la
// siguen hasta la próxima marca o hasta la primera línea vacía: el generador separa cada
// función, la librería enlazada, el runtime y los datos con una línea vacía, y no emite
// líneas vacías dentro de una función (las de un __asm llevan marca propia si no están
// vacías). Así el epílogo de una función cuenta como su última sentencia y el código de
// la librería no es de ninguna línea C.
//
// Con el lineMap del ensamblado del texto generado: PC → línea generada → línea C.
import type { AsmLineInfo } from "../../asm";
import type { CLine } from "../../cc";

export interface SrcLoc { file: string; line: number }

/** Para cada línea del ensamblador generado (1-based), índice en cLineMap o −1. */
export function asmLineOwners(asm: string, cLineMap: readonly CLine[]): Int32Array {
  const lines = asm.split("\n");
  const mark = new Int32Array(lines.length + 2).fill(-1);
  cLineMap.forEach((c, k) => { if (c.asmLine <= lines.length) mark[c.asmLine] = k; });
  const owner = new Int32Array(lines.length + 2).fill(-1);
  let cur = -1;
  for (let l = 1; l <= lines.length; l++) {
    if (mark[l]! >= 0) cur = mark[l]!;
    else if (lines[l - 1]!.trim() === "") cur = -1;
    owner[l] = cur;
  }
  return owner;
}

export class SourceMap {
  private locs: SrcLoc[] = [];
  private keys = new Map<string, number>();
  /** Dirección → índice de loc en el fuente (C o ensamblador de usuario); −1 = nada. */
  private src = new Int32Array(65536).fill(-1);
  /** Dirección → índice de loc en el ensamblador generado (sólo programas C). */
  private gen = new Int32Array(65536).fill(-1);
  /** Loc → direcciones donde empieza un tramo de código suyo (para breakpoints). */
  private starts: number[][] = [];
  /** 1 en la primera instrucción de cada tramo de una línea del fuente (paso por línea). */
  readonly lineStart = new Uint8Array(65536);
  /**
   * 1 en la primera instrucción de cada función C: la marca de su primera línea va justo
   * detrás de la etiqueta de la función ("_main:"), antes del prólogo (paso por encima).
   */
  readonly funcEntry = new Uint8Array(65536);

  private loc(file: string, line: number): number {
    const k = `${file}\n${line}`;
    let i = this.keys.get(k);
    if (i === undefined) {
      i = this.locs.length;
      this.keys.set(k, i);
      this.locs.push({ file, line });
      this.starts.push([]);
    }
    return i;
  }

  private fill(layer: Int32Array, idx: number, e: AsmLineInfo, start: boolean): void {
    for (let i = 0; i < e.len; i++) layer[(e.addr + i) & 0xffff] = idx;
    if (start && e.len > 0) this.starts[idx]!.push(e.addr & 0xffff);
  }

  /** Programa en ensamblador: `main` es la pestaña ensamblada; `incName` traduce el file de un INCLUDE a su pestaña. */
  static fromAsm(lineMap: readonly AsmLineInfo[], main: string, incName: (file: string) => string = (f) => f): SourceMap {
    const m = new SourceMap();
    let prev = -1;
    for (const e of lineMap) {
      const idx = m.loc(e.file === undefined ? main : incName(e.file), e.line);
      const start = idx !== prev;
      m.fill(m.src, idx, e, start);
      if (start && e.len > 0) m.lineStart[e.addr & 0xffff] = 1;
      prev = idx;
    }
    return m;
  }

  /** Programa C: `asm` es el texto generado (pestaña `genName`) y `lineMap` el de su ensamblado. */
  static fromC(asm: string, cLineMap: readonly CLine[], lineMap: readonly AsmLineInfo[], genName: string): SourceMap {
    const m = new SourceMap();
    const owner = asmLineOwners(asm, cLineMap);
    const text = asm.split("\n");
    const isFunc = cLineMap.map((c) => /^[A-Za-z_]\w*:\s*$/.test(text[c.asmLine - 2] ?? ""));
    let prevGen = -1, prevC = -1;
    for (const e of lineMap) {
      if (e.file !== undefined) continue; // el texto generado no tiene INCLUDE
      const g = m.loc(genName, e.line);
      m.fill(m.gen, g, e, g !== prevGen);
      prevGen = g;
      const k = owner[e.line] ?? -1;
      if (k < 0) { prevC = -1; continue; }
      const c = cLineMap[k]!;
      const idx = m.loc(c.file, c.line);
      const start = k !== prevC;
      m.fill(m.src, idx, e, start);
      if (start && e.len > 0) {
        m.lineStart[e.addr & 0xffff] = 1;
        if (isFunc[k]) m.funcEntry[e.addr & 0xffff] = 1;
      }
      prevC = k;
    }
    return m;
  }

  /** Línea del fuente cuyo código contiene `addr`. */
  srcAt(addr: number): SrcLoc | null {
    const i = this.src[addr & 0xffff]!;
    return i < 0 ? null : this.locs[i]!;
  }

  /** Línea de la pestaña `file` (fuente o generada) cuyo código contiene `addr`. */
  lineIn(file: string, addr: number): number | null {
    for (const layer of [this.src, this.gen]) {
      const i = layer[addr & 0xffff]!;
      if (i >= 0 && this.locs[i]!.file === file) return this.locs[i]!.line;
    }
    return null;
  }

  /** Direcciones de inicio de cada tramo de código de (file, line), en orden de dirección. */
  addrsOf(file: string, line: number): number[] {
    const i = this.keys.get(`${file}\n${line}`);
    return i === undefined ? [] : [...this.starts[i]!].sort((a, b) => a - b);
  }
}
