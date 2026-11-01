// D1: montaje del depurador en la web. main.ts sólo llama a mountDebugger y, tras cada
// ensamblado, a programLoaded.
import type { AsmResult } from "../../asm";
import type { EditorView } from "@codemirror/view";
import { Debugger, type DbgCore, type DbgLoop } from "./controller";
import { attachEditorDebug } from "./editor-ext";
import { DebuggerPanel } from "./panel";

export { Debugger } from "./controller";

export interface DebuggerOptions {
  host: HTMLElement;
  core: DbgCore;
  loop: DbgLoop;
  view: EditorView;
  say(text: string): void;
}

export interface DebuggerHandle {
  readonly dbg: Debugger;
  /** Tras ensamblar: mapa fuente ↔ dirección y breakpoints del margen. */
  programLoaded(asm: AsmResult, ok: boolean): void;
  /** Muestra el panel parado en el PC actual ("Ensamblar y depurar"). */
  stopHere(): void;
}

const KEYS: Record<string, string> = { F4: "cursor", F5: "run", F7: "step", F8: "over" };

export function mountDebugger(o: DebuggerOptions): DebuggerHandle {
  const dbg = new Debugger(o.core, o.loop);
  const ed = attachEditorDebug(o.view, () => syncSourceBps());
  const panel = new DebuggerPanel(o.host, dbg, {
    editorCursorAddr: () => dbg.addrOfLine(ed.cursorLine()),
    say: o.say,
  });

  function syncSourceBps(): void {
    const addrs: number[] = [];
    for (const l of ed.bpLines()) {
      const a = dbg.addrOfLine(l);
      if (a !== null) addrs.push(a);
    }
    dbg.setSourceBps(addrs);
  }

  let lastLine: number | null = null;
  const showCurrent = () => {
    const line = o.loop.isPaused ? dbg.lineOf(dbg.pc) : null;
    if (line === lastLine) return;
    lastLine = line;
    ed.setCurrentLine(line, line !== null);
  };
  dbg.events.on("change", showCurrent);
  o.loop.events.on("paused", showCurrent);
  o.loop.events.on("frame", () => panel.onFrame());
  o.loop.events.on("breakpoint", () => {
    if (o.loop.isPaused && o.host.hidden) { o.host.hidden = false; panel.render(); }
  });
  o.view.contentDOM.addEventListener("focus", () => panel.pickedEditor());

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "F9") {
      e.preventDefault();
      ed.toggleAtCursor();
      return;
    }
    const a = KEYS[e.key];
    if (!a || o.host.hidden) return;
    e.preventDefault();
    panel.command(a);
  });

  return {
    dbg,
    programLoaded(asm, ok) {
      if (!ok) return;
      dbg.setProgram(asm.lineMap);
      lastLine = -1; // forzar el repintado de la línea actual
      syncSourceBps();
      showCurrent();
    },
    stopHere() {
      o.loop.setPaused(true);
      o.host.hidden = false;
      panel.render();
      showCurrent();
    },
  };
}
