// U1: depurador sobre pestañas (DOM). Sustituye a mountDebugger de D1 en la web: usa su
// Debugger (controller.ts) y su DebuggerPanel tal cual, pero los breakpoints del margen y
// la línea actual van por pestaña, a través del SourceMap del último programa (C o
// ensamblador). Añade "Paso C" y "Por encima C" (paso por línea del fuente).
import type { AsmResult } from "../../asm";
import { Debugger, type DbgCore, type DbgLoop } from "../debugger/controller";
import { DebuggerPanel } from "../debugger/panel";
import { TSTATES_PER_FRAME } from "../../emu/core";
import type { TabsEditor } from "./editor";
import type { SourceMap } from "./srcmap";

/** Presupuesto de un paso por línea: si no se llega a otra línea en 10 frames se para igual. */
const LINE_STEP_FRAMES = 10;
const KEYS: Record<string, string> = { F4: "cursor", F5: "run", F7: "step", F8: "over" };

export interface TabsDebuggerOptions {
  host: HTMLElement;
  core: DbgCore;
  loop: DbgLoop;
  tabs: TabsEditor;
  say(text: string): void;
}

export interface TabsDebugger {
  readonly dbg: Debugger;
  /** Tras construir: mapa de depuración y breakpoints de los márgenes. */
  programLoaded(asm: AsmResult, map: SourceMap, ok: boolean): void;
  /** Muestra el panel parado en el PC actual. */
  stopHere(): void;
  /** Muestra el panel y corre hasta `addr` (Depurar un programa C: hasta _main). */
  runTo(addr: number): void;
  /** Breakpoints de los márgenes → núcleo (al cambiar alguno en cualquier pestaña). */
  syncSourceBps(): void;
  /** Línea actual en las pestañas (tras cambiar de pestaña, etc.). */
  showCurrent(): void;
  /** Paso por línea del fuente; `over` no entra en las funciones C llamadas. */
  stepLine(over: boolean): void;
}

/**
 * Paso por línea (sin DOM, para los tests): instrucciones hasta la primera de un tramo de
 * línea del fuente. Con `over`, al entrar en una función C (su primera línea) se sigue
 * hasta que vuelve (SP por encima del de la entrada), así que recursión incluida no se
 * para dentro. Devuelve false si se agotó el presupuesto.
 */
export function stepSourceLine(dbg: Debugger, core: DbgCore, map: SourceMap, over: boolean, budget = LINE_STEP_FRAMES * TSTATES_PER_FRAME): boolean {
  let floor = -1; // SP en la entrada de la función en la que se ha entrado; −1 = ninguna
  return dbg.stepUntil(() => {
    const pc = dbg.pc;
    const sp = core.regs.get16("sp");
    if (floor >= 0) {
      if (sp <= floor) return false;
      floor = -1;
    }
    if (map.lineStart[pc] !== 1) return false;
    if (over && map.funcEntry[pc] === 1) { floor = sp; return false; }
    return true;
  }, budget);
}

export function mountTabsDebugger(o: TabsDebuggerOptions): TabsDebugger {
  const dbg = new Debugger(o.core, o.loop);
  const tabs = o.tabs;
  let map: SourceMap | null = null;
  const panel = new DebuggerPanel(o.host, dbg, {
    editorCursorAddr: () => {
      const t = tabs.model.active;
      return t && map ? map.addrsOf(t.name, tabs.cursorLine())[0] ?? null : null;
    },
    say: o.say,
  });

  // Botones de paso por línea en la barra del panel, detrás de "Por encima".
  const bar = o.host.querySelector(".dbg-bar")!;
  const before = bar.querySelector('[data-a="cursor"]');
  for (const [a, label, title] of [
    ["line", "Paso C", "Paso por línea del fuente: entra en las funciones (F6)"],
    ["line-over", "Por encima C", "Paso por línea del fuente sin entrar en las funciones C llamadas (Mayús+F6)"],
  ] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.u1 = a;
    b.textContent = label;
    b.title = title;
    bar.insertBefore(b, before);
  }
  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (b?.dataset.u1) stepLine(b.dataset.u1 === "line-over");
    // "Quitar bps" del panel vacía el núcleo; aquí se quitan también los puntos del margen.
    if (b?.dataset.a === "clear") tabs.clearBps();
  });

  function syncSourceBps(): void {
    const addrs: number[] = [];
    if (map) for (const t of tabs.model.tabs) for (const l of tabs.bpLines(t)) addrs.push(...map.addrsOf(t.name, l));
    dbg.setSourceBps(addrs);
  }

  function showCurrent(): void {
    const lines = new Map<number, number>();
    if (map && o.loop.isPaused) {
      const pc = dbg.pc;
      for (const t of tabs.model.tabs) {
        const l = map.lineIn(t.name, pc);
        if (l !== null) lines.set(t.id, l);
      }
      // Parado en código de otra pestaña (una función de otro .c, un INCLUDE): se va a ella.
      const active = tabs.model.active;
      if (active && !lines.has(active.id)) {
        const loc = map.srcAt(pc);
        const t = loc ? tabs.model.find(loc.file) : undefined;
        if (t) tabs.activate(t.id);
      }
    }
    tabs.setCurrentLines(lines);
  }

  function stepLine(over: boolean): void {
    if (!map) { o.say("Construye el programa con «Depurar» para poder ir por líneas."); return; }
    o.host.hidden = false;
    if (!stepSourceLine(dbg, o.core, map, over)) {
      o.say(`No se ha llegado a otra línea del fuente en ${LINE_STEP_FRAMES} frames (¿espera una tecla o ha vuelto a BASIC?). Parado en PC=${dbg.pc.toString(16).toUpperCase().padStart(4, "0")}h.`);
    }
    panel.render();
  }

  dbg.events.on("change", showCurrent);
  o.loop.events.on("paused", showCurrent);
  o.loop.events.on("frame", () => panel.onFrame());
  o.loop.events.on("breakpoint", () => {
    if (o.loop.isPaused && o.host.hidden) { o.host.hidden = false; panel.render(); }
  });
  tabs.view.contentDOM.addEventListener("focus", () => panel.pickedEditor());

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "F9") { e.preventDefault(); tabs.toggleBpAtCursor(); return; }
    if (e.key === "F6") { e.preventDefault(); stepLine(e.shiftKey); return; }
    const a = KEYS[e.key];
    if (!a || o.host.hidden || e.shiftKey) return;
    e.preventDefault();
    panel.command(a);
  });

  return {
    dbg,
    programLoaded(asm, m, ok) {
      if (!ok) return;
      map = m;
      dbg.setProgram(asm.lineMap);
      tabs.resetCurrent();
      syncSourceBps();
      showCurrent();
    },
    stopHere() {
      o.loop.setPaused(true);
      o.host.hidden = false;
      panel.render();
      showCurrent();
    },
    runTo(addr) {
      o.host.hidden = false;
      // Si corría, la pausa programa una microtarea del Debugger que quita el breakpoint
      // temporal si no ha habido parada; runTo va detrás de ella para que no se lo lleve.
      o.loop.setPaused(true);
      queueMicrotask(() => { dbg.runTo(addr); panel.render(); });
    },
    syncSourceBps,
    showCurrent,
    stepLine,
  };
}
