// Modelo REF de contención de memoria y de E/S del Spectrum 48K.
//
// Escrito a partir de docs/zx48-hardware.md §4 y §5 (y contrastado con Fuse:
// spectrum.c contend_delay_common, peripherals/ula.c ula_contend_port_early/late,
// periph.c readport/writeport). NO se ha mirado core/src/*.c.
//
// Lento y obvio a propósito: nada de tablas precalculadas; cada consulta recalcula
// la línea y el desplazamiento.

export const TSTATES_PER_LINE = 224; // DOC §1
export const LINES_PER_FRAME = 312; // DOC §1
export const TSTATES_PER_FRAME = 69888; // DOC §1
export const FIRST_CONTENDED = 14335; // DOC §4: primer T contendido tras /INT
export const SCREEN_LINES = 192; // DOC §1
export const CONTENDED_PER_LINE = 128; // DOC §4
export const PATTERN = [6, 5, 4, 3, 2, 1, 0, 0] as const; // DOC §4

/** L(n) de TEST-PLAN §4: primer T contendido de la línea de pantalla n (0..191). */
export function lineStart(n: number): number {
  return FIRST_CONTENDED + TSTATES_PER_LINE * n;
}

/**
 * Retardo de contención (en T) que sufre un ciclo de bus que empieza en el T-state t
 * (relativo al inicio de /INT) con una dirección contendida. DOC §4.
 * Para t ≥ 69888 (instrucción que cruza el final del frame) la ULA ya está en el
 * borde superior del frame siguiente: retardo 0 (Fuse hace lo mismo: la línea sale
 * ≥ 216 y contend_delay_common devuelve 0).
 */
export function memDelay(t: number): number {
  const o = t - FIRST_CONTENDED;
  if (o < 0) return 0;
  const line = Math.floor(o / TSTATES_PER_LINE);
  if (line >= SCREEN_LINES) return 0;
  const k = o - line * TSTATES_PER_LINE;
  if (k >= CONTENDED_PER_LINE) return 0;
  return PATTERN[k % 8]!;
}

/** DOC §3/§4: 0x4000–0x7FFF es la RAM contendida. */
export function isContended(addr: number): boolean {
  return (addr & 0xc000) === 0x4000;
}

// ---------------------------------------------------------------------------
// Patrones de bus
// ---------------------------------------------------------------------------

/**
 * Un ciclo de bus tal y como lo describe la referencia del 48K ("Contended memory"):
 *  - mem: ciclo que pone `addr` en el bus durante `len` T (lectura, escritura o ciclo
 *    interno con dirección, p. ej. "hl:1"). Contención en su primer T y luego `len` T.
 *  - io:  ciclo de E/S completo de 4 T con la contención de DOC §5.
 *  - tick: T internos sin dirección en el bus (nunca contendidos).
 */
export type BusCycle =
  | { kind: "mem"; addr: number; len: number; write?: boolean }
  | { kind: "io"; port: number; write: boolean }
  | { kind: "tick"; len: number };

export interface CycleTiming {
  cycle: BusCycle;
  /** T en el que el ciclo quiere empezar (antes de contención). */
  start: number;
  /** Retardo total de contención que ha sufrido. */
  delay: number;
  /** T al final del ciclo. */
  end: number;
  /**
   * Sólo E/S: T exacto en que la ULA ve el dato (escritura) o en que se muestrea el
   * bus de datos (lectura). Convención de Fuse (periph.c):
   *   writeport: early → escribe → late → +1   ⇒ escritura tras la parte "early"
   *   readport:  early → late → lee → +1       ⇒ lectura 1 T antes del final
   */
  dataT?: number;
  /** Sólo mem: T en que se completa el acceso (convención Fuse: tras sumar len). */
  accessT?: number;
}

/**
 * Contención de E/S, DOC §5. Devuelve los T del ciclo (con retardos) y el momento
 * del dato. Tabla:
 *
 *   high byte en 0x40–0x7F | bit 0 | patrón
 *   no                     | 0     | N:1, C:3
 *   no                     | 1     | N:4
 *   sí                     | 0     | C:1, C:3
 *   sí                     | 1     | C:1, C:1, C:1, C:1
 *
 * "C:n" = aplicar contención en ese instante y luego n T. El momento del dato sale de
 * Fuse (peripherals/ula.c + periph.c): en escritura, tras el primer tramo (1 T + su
 * contención); en lectura, justo antes del último T.
 */
export function ioCycle(start: number, port: number, write: boolean): CycleTiming {
  const highContended = isContended(port & 0xffff);
  const ula = (port & 1) === 0;
  let t = start;
  let delay = 0;
  const c = () => {
    const d = memDelay(t);
    delay += d;
    t += d;
  };
  // Parte "early": C:1 si el byte alto es contendido, si no N:1.
  if (highContended) c();
  t += 1;
  const writeT = t;
  // Parte "late".
  if (ula) {
    c();
    t += 2;
  } else if (highContended) {
    c();
    t += 1;
    c();
    t += 1;
    c();
  } else {
    t += 2;
  }
  const readT = t;
  t += 1;
  return { cycle: { kind: "io", port, write }, start, delay, end: t, dataT: write ? writeT : readT };
}

/** Ejecuta un patrón de ciclos a partir del T `start` y devuelve el T de cada uno. */
export function runPattern(start: number, cycles: BusCycle[]): { end: number; timings: CycleTiming[] } {
  let t = start;
  const timings: CycleTiming[] = [];
  for (const cy of cycles) {
    if (cy.kind === "tick") {
      timings.push({ cycle: cy, start: t, delay: 0, end: t + cy.len });
      t += cy.len;
    } else if (cy.kind === "mem") {
      const d = isContended(cy.addr) ? memDelay(t) : 0;
      const end = t + d + cy.len;
      timings.push({ cycle: cy, start: t, delay: d, end, accessT: end });
      t = end;
    } else {
      const io = ioCycle(t, cy.port, cy.write);
      timings.push(io);
      t = io.end;
    }
  }
  return { end: t, timings };
}

// ---------------------------------------------------------------------------
// Patrones de bus de las instrucciones que usan los tests ULA-*.
// Fuente: ZX Spectrum 48K Technical Reference, § "Contended memory" (DOC fuente 2),
// la misma notación "pc:4, pc+1:3, IO". Las direcciones relevantes se pasan como
// parámetros. Sólo las instrucciones que usan los tests; no es un Z80.
// ---------------------------------------------------------------------------

const M = (addr: number, len: number, write = false): BusCycle => ({ kind: "mem", addr: addr & 0xffff, len, write });
const IO = (port: number, write: boolean): BusCycle => ({ kind: "io", port: port & 0xffff, write });

export const PATTERNS = {
  /** NOP, LD r,r', EI, DI, HALT (cada M1): pc:4 */
  nop: (pc: number) => [M(pc, 4)],
  /** LD A,n / LD r,n: pc:4, pc+1:3 */
  ldRN: (pc: number) => [M(pc, 4), M(pc + 1, 3)],
  /** LD (HL),r: pc:4, hl:3 */
  ldHLr: (pc: number, hl: number) => [M(pc, 4), M(hl, 3, true)],
  /** LD r,(HL): pc:4, hl:3 */
  ldRHL: (pc: number, hl: number) => [M(pc, 4), M(hl, 3)],
  /** INC (HL): pc:4, hl:3, hl:1, hl(write):3 */
  incHL: (pc: number, hl: number) => [M(pc, 4), M(hl, 3), M(hl, 1), M(hl, 3, true)],
  /** JP nn: pc:4, pc+1:3, pc+2:3 */
  jp: (pc: number) => [M(pc, 4), M(pc + 1, 3), M(pc + 2, 3)],
  /** JR e: pc:4, pc+1:3, pc+1:1 ×5 */
  jr: (pc: number) => [M(pc, 4), M(pc + 1, 3), ...Array.from({ length: 5 }, () => M(pc + 1, 1))],
  /** IN A,(n): pc:4, pc+1:3, IO */
  inAN: (pc: number, port: number) => [M(pc, 4), M(pc + 1, 3), IO(port, false)],
  /** OUT (n),A: pc:4, pc+1:3, IO */
  outNA: (pc: number, port: number) => [M(pc, 4), M(pc + 1, 3), IO(port, true)],
  /** IN r,(C): pc:4, pc+1:4, IO */
  inRC: (pc: number, port: number) => [M(pc, 4), M(pc + 1, 4), IO(port, false)],
  /** OUT (C),r: pc:4, pc+1:4, IO */
  outCR: (pc: number, port: number) => [M(pc, 4), M(pc + 1, 4), IO(port, true)],
  /** INI: pc:4, pc+1:4, ir:1, IO, hl:3. ir = I*256+R (no contendida si I < 0x40). */
  ini: (pc: number, ir: number, port: number, hl: number) => [M(pc, 4), M(pc + 1, 4), M(ir, 1), IO(port, false), M(hl, 3, true)],
  /** OUTI: pc:4, pc+1:4, ir:1, hl:3, IO. El puerto usa B ya decrementado. */
  outi: (pc: number, ir: number, hl: number, port: number) => [M(pc, 4), M(pc + 1, 4), M(ir, 1), M(hl, 3), IO(port, true)],
} as const;
