// D1: lógica del depurador, sin DOM. La usan el panel y los tests contra el núcleo real.
//
// Breakpoints: el núcleo tiene un único mapa de bits (core/src/debug.c). Aquí se guardan
// tres orígenes y el mapa es su unión, que se reescribe entera en cada cambio (8 KB de
// memset en el núcleo + unos pocos zx_bp_set: despreciable y sin estado duplicado que
// pueda desincronizarse):
//   - de dirección (clic en el desensamblado),
//   - de fuente (margen del editor, traducidos a dirección con el lineMap del último
//     ensamblado),
//   - uno temporal para "paso por encima" y "hasta el cursor".
//
// Semántica de parada (core/include/zx.h): ZX_STOP_BREAKPOINT para ANTES de ejecutar la
// instrucción y el siguiente zx_run_frame la ejecuta sin volver a parar; zx_step ignora
// los breakpoints (ui/run.ts depende de ello). Continuar = un zx_step y reanudar el bucle,
// así se sale de la dirección actual aunque se haya llegado a ella por un paso.
import { disassemble, type DisasmLine } from "../../disasm";
import { Emitter, type LoopEvents } from "../../emu/loop";
import { TSTATES_PER_FRAME } from "../../emu/core";
import type { Reg16, Reg8, RegsSnapshot } from "../../emu/regs";
import type { AsmLineInfo } from "../../asm";

export interface DbgCore {
  x: {
    zx_step(): number;
    zx_bp_set(addr: number, on: number): void;
    zx_bp_clear_all(): void;
    zx_tstate(): number;
    zx_frame_count(): number;
    zx_poke(addr: number, v: number): void;
  };
  regs: { get16(r: Reg16): number; get8(r: Reg8): number; snapshot(): RegsSnapshot };
  ram(): Uint8Array;
}

/** Lo que el depurador necesita del bucle (Loop de emu/loop.ts lo cumple). */
export interface DbgLoop {
  readonly isPaused: boolean;
  setPaused(p: boolean): void;
  readonly events: Emitter<LoopEvents>;
}

export interface DbgEvents {
  /** El estado visible cambió (paso, parada, breakpoints, memoria): repintar. */
  change: void;
}

interface TempBp {
  addr: number;
  /** Paso por encima: SP al empezar. Si se llega con SP menor es una llamada más
   * profunda (recursión) y se sigue. null = parar siempre (hasta el cursor). */
  sp: number | null;
}

/** Máximo de prefijos DD/FD sin efecto que se saltan al decidir "paso por encima". */
const MAX_PREFIX_RUN = 8;

export class Debugger {
  readonly events = new Emitter<DbgEvents>();
  private addrBps = new Set<number>();
  private srcBps = new Set<number>();
  private temp: TempBp | null = null;
  private sawBreak = false;
  /** Dirección → línea (1-based) del fuente principal; 0 = no es del programa. */
  private lineOfAddr = new Uint32Array(65536);
  private lineMap: readonly AsmLineInfo[] = [];

  constructor(private core: DbgCore, private loop: DbgLoop) {
    loop.events.on("breakpoint", () => this.onBreakpoint());
    loop.events.on("paused", (p) => {
      if (!p) return;
      // Loop emite "paused" y justo después "breakpoint" si la parada es de uno.
      this.sawBreak = false;
      queueMicrotask(() => {
        if (!this.sawBreak) this.dropTemp();
        this.events.emit("change", undefined);
      });
    });
  }

  get pc(): number { return this.core.regs.get16("pc"); }
  get paused(): boolean { return this.loop.isPaused; }
  get tempAddr(): number | null { return this.temp?.addr ?? null; }
  ram(): Uint8Array { return this.core.ram(); }
  regs(): RegsSnapshot { return this.core.regs.snapshot(); }

  // ---- Breakpoints ----

  hasBp(addr: number): boolean { return this.addrBps.has(addr) || this.srcBps.has(addr); }
  hasAddrBp(addr: number): boolean { return this.addrBps.has(addr); }
  get addressBreakpoints(): number[] { return [...this.addrBps].sort((a, b) => a - b); }

  /** Breakpoint de dirección (desensamblado). Devuelve si queda puesto. */
  toggleBp(addr: number): boolean {
    addr &= 0xffff;
    const on = !this.addrBps.has(addr);
    if (on) this.addrBps.add(addr); else this.addrBps.delete(addr);
    this.sync();
    return on;
  }

  /** Sustituye los breakpoints que vienen del margen del editor. */
  setSourceBps(addrs: Iterable<number>): void {
    this.srcBps = new Set([...addrs].map((a) => a & 0xffff));
    this.sync();
  }

  clearAll(): void {
    this.addrBps.clear();
    this.srcBps.clear();
    this.temp = null;
    this.sync();
  }

  private sync(): void {
    const x = this.core.x;
    x.zx_bp_clear_all();
    for (const a of this.addrBps) x.zx_bp_set(a, 1);
    for (const a of this.srcBps) x.zx_bp_set(a, 1);
    if (this.temp) x.zx_bp_set(this.temp.addr, 1);
    this.events.emit("change", undefined);
  }

  private setTemp(t: TempBp | null): void {
    this.temp = t;
    this.sync();
  }

  private dropTemp(): void {
    if (this.temp) this.setTemp(null);
  }

  // ---- Programa ensamblado (fuente ↔ dirección) ----

  setProgram(lineMap: readonly AsmLineInfo[]): void {
    this.lineMap = lineMap;
    this.lineOfAddr.fill(0);
    for (const e of lineMap) {
      if (e.file !== undefined) continue;
      for (let i = 0; i < e.len; i++) this.lineOfAddr[(e.addr + i) & 0xffff] = e.line;
    }
  }

  /** Línea del fuente cuyo código contiene `addr`, o null. */
  lineOf(addr: number): number | null { return this.lineOfAddr[addr & 0xffff] || null; }

  /** Dirección de la primera instrucción generada por `line`, o null. */
  addrOfLine(line: number): number | null {
    for (const e of this.lineMap) if (e.file === undefined && e.line === line) return e.addr;
    return null;
  }

  // ---- Ejecución ----

  pause(): void { this.loop.setPaused(true); }

  /** Una instrucción (o la aceptación de una INT). Pausa primero si corría. */
  step(): void {
    this.loop.setPaused(true);
    this.temp = null;
    this.sync();
    this.core.x.zx_step();
    this.events.emit("change", undefined);
  }

  /**
   * U1 (paso por línea C): instrucciones con zx_step hasta que `stop()` se cumpla, se
   * llegue a un breakpoint o pasen `budget` T. Al menos una. Devuelve si paró por
   * `stop` o por un breakpoint (false = se agotó el presupuesto).
   */
  stepUntil(stop: () => boolean, budget: number): boolean {
    this.loop.setPaused(true);
    this.temp = null;
    this.sync();
    const x = this.core.x;
    const now = () => x.zx_frame_count() * TSTATES_PER_FRAME + x.zx_tstate();
    const end = now() + budget;
    let hit = false;
    do {
      x.zx_step();
      if (stop() || this.hasBp(this.pc)) { hit = true; break; }
    } while (now() < end);
    this.events.emit("change", undefined);
    return hit;
  }

  /** Reanuda el bucle; la instrucción actual se ejecuta aunque tenga breakpoint. */
  resume(): void {
    if (!this.loop.isPaused) return;
    this.core.x.zx_step();
    this.loop.setPaused(false);
    this.events.emit("change", undefined);
  }

  /** Instrucción que se ejecutará de verdad en el PC: salta los DD/FD sin efecto. */
  effective(addr = this.pc): { start: number; line: DisasmLine } {
    const ram = this.core.ram();
    let a = addr & 0xffff;
    let line = disassemble(ram, a);
    for (let i = 0; i < MAX_PREFIX_RUN && line.kind === "prefix"; i++) {
      a = (a + 1) & 0xffff;
      line = disassemble(ram, a);
    }
    return { start: a, line };
  }

  /**
   * CALL/RST/DJNZ/bloque repetitivo: breakpoint temporal en la instrucción siguiente y
   * se corre; el resto, un paso.
   */
  stepOver(): void {
    this.loop.setPaused(true);
    const { start, line } = this.effective();
    if (!line.stepOver) { this.step(); return; }
    this.setTemp({ addr: (start + line.len) & 0xffff, sp: this.core.regs.get16("sp") });
    this.resume();
  }

  /** Corre hasta que el PC llegue a `addr` (o a otro breakpoint). */
  runTo(addr: number): void {
    this.loop.setPaused(true);
    this.setTemp({ addr: addr & 0xffff, sp: null });
    this.resume();
  }

  private onBreakpoint(): void {
    this.sawBreak = true;
    const t = this.temp;
    if (t && this.pc === t.addr && t.sp !== null && this.core.regs.get16("sp") < t.sp
        && !this.hasBp(t.addr)) {
      // La misma dirección dentro de una llamada más profunda: seguir. El núcleo ya
      // deja saltar el breakpoint en el que acaba de parar.
      this.loop.setPaused(false);
      return;
    }
    this.dropTemp();
    this.events.emit("change", undefined);
  }

  // ---- Memoria y tiempo ----

  poke(addr: number, v: number): void {
    this.core.x.zx_poke(addr & 0xffff, v & 0xff);
    this.events.emit("change", undefined);
  }

  /** T-state del frame, línea de pantalla (t/224), T dentro de la línea y frame. */
  time(): { t: number; line: number; col: number; frame: number } {
    const t = this.core.x.zx_tstate();
    return { t, line: Math.floor(t / 224), col: t % 224, frame: this.core.x.zx_frame_count() };
  }
}
