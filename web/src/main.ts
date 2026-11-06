// Composición de la web: núcleo, pantalla, teclado, bucle, audio, ficheros y controles.
import romUrl from "../../rom/48.rom?url";
import { Core } from "./emu/core";
import { Display, parseScale } from "./emu/display";
import { KeyState, attachKeyboard } from "./emu/input";
import { Loop, type LoopAudio } from "./emu/loop";
import { loadFile } from "./ui/files";
import { initSplitter, loadPref, savePref } from "./ui/layout";
import { DEFAULT_EXAMPLE, EXAMPLES } from "./ui/editor/examples";
import type { RunMessage } from "./ui/run";
import { CLIB_FILES, C_EXAMPLES, DEFAULT_C_EXAMPLE } from "./clib";
import { TabsEditor, buildAndRun, buildTapFor, mountTabsDebugger, type TabKind, type TabsDebugger } from "./ui/tabs";
import { downloadBytes, stampedName } from "./export";
import { registerBuiltinResources } from "./ui/res";
import { resourceKinds } from "./res/registry";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// audio.ts (M2) se importa de forma opcional: si aún no existe, el glob queda vacío y
// la web funciona con el reloj de requestAnimationFrame.
interface AudioOutLike extends LoopAudio {
  start(): Promise<void>;
  setMuted(m: boolean): void;
}
const audioModules = import.meta.glob<{ AudioOut: { create(): Promise<AudioOutLike> } }>("./emu/audio.ts");

const status = $<HTMLSpanElement>("emu-status");
const msg = $<HTMLDivElement>("emu-msg");

function showMessage(text: string, kind: "error" | "info"): void {
  msg.className = `msg ${kind}`;
  msg.textContent = text;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.title = "Cerrar";
  close.onclick = () => { msg.hidden = true; };
  msg.append(close);
  msg.hidden = false;
}

const fmt = (x: number, d: number) => x.toFixed(d).replace(".", ",");
const hex4 = (x: number) => x.toString(16).toUpperCase().padStart(4, "0");

// ---- IDE (I1, U1: pestañas): se monta antes que el núcleo, así se puede editar aunque éste falle ----
const asmLog = $<HTMLPreElement>("asm-log");
function showLog(lines: RunMessage[]): void {
  asmLog.replaceChildren(...lines.map((m) => {
    const s = document.createElement("span");
    s.className = m.severity;
    s.textContent = m.text + "\n";
    return s;
  }));
}
const say = (text: string) => showLog([{ severity: "info", text }]);
let runProgram: (() => void) | null = null;
let dbgUi: TabsDebugger | null = null;
registerBuiltinResources();
const tabs = new TabsEditor({
  bar: $("tabs"),
  host: $("editor"),
  prefs: { get: loadPref, set: savePref },
  defaults: { asm: DEFAULT_EXAMPLE.source, c: DEFAULT_C_EXAMPLE.source },
  onRun: () => runProgram?.(),
  say,
  onBpsChanged: () => dbgUi?.syncSourceBps(),
  onSwitch: () => dbgUi?.showCurrent(),
});
// Si se cierra la página antes del guardado diferido.
addEventListener("pagehide", () => tabs.save());

/** Lo que se ejecuta: la pestaña activa si es un programa; si no, la principal. */
function runTarget() {
  tabs.flush();
  const t = tabs.model.runTarget();
  if (!t) showLog([{ severity: "error", text: "No hay nada que ejecutar: abre una pestaña .asm o un .c con main()." }]);
  return t;
}

// Ejemplos ASM y C: se abren en una pestaña nueva (no se pierde nada).
const exSel = $<HTMLSelectElement>("asm-example");
{
  exSel.replaceChildren(new Option("Ejemplos…", ""));
  const groups: [string, "asm" | "c", readonly { id: string; title: string }[]][] = [["Ensamblador Z80", "asm", EXAMPLES], ["C", "c", C_EXAMPLES]];
  for (const [label, kind, list] of groups) {
    const g = document.createElement("optgroup");
    g.label = label;
    for (const ex of list) g.append(new Option(ex.title, `${kind}:${ex.id}`));
    exSel.append(g);
  }
  exSel.onchange = () => {
    const [kind, id] = exSel.value.split(":") as ["asm" | "c", string];
    exSel.value = "";
    const ex = (kind === "asm" ? EXAMPLES : C_EXAMPLES).find((e) => e.id === id);
    if (!ex) return;
    const tab = tabs.openExample(ex.id, kind, ex.source);
    tabs.view.focus();
    say(`Abierto el ejemplo «${ex.title}» en «${tab.name}». Ctrl+Enter para ejecutarlo.`);
  };
}
const libSel = $<HTMLSelectElement>("lib-view");
libSel.replaceChildren(new Option("Ver librería…", ""), ...[...CLIB_FILES.keys()].map((n) => new Option(n, n)));
libSel.onchange = () => {
  const f = libSel.value;
  libSel.value = "";
  if (f) tabs.openLib(f);
};
const newSel = $<HTMLSelectElement>("tab-new");
for (const r of resourceKinds()) newSel.append(new Option(`Nueva ${r.label.toLowerCase()} .${r.ext}`, `res:${r.ext}`));
newSel.onchange = () => {
  const v = newSel.value;
  newSel.value = "";
  if (v.startsWith("res:")) tabs.newResource(v.slice(4));
  else if (v) tabs.newTab(v as TabKind);
};

// ---- Exportar TAP (E1): sólo construye, no necesita el núcleo ----
$("asm-export-tap").onclick = () => {
  const target = runTarget();
  if (!target) return;
  tabs.model.setMain(target.id);
  const r = buildTapFor(tabs.model, target);
  if (r.build.kind === "c" && r.build.ok) tabs.setGenerated(r.build.source);
  tabs.showDiags(r.diags);
  tabs.renderBar();
  showLog(r.messages);
  const base = target.name.replace(/\.[^.]*$/, "");
  if (r.exp?.tap) downloadBytes(r.exp.tap, stampedName(base, "tap", new Date()));
};

async function boot(): Promise<void> {
  initSplitter($("app"), $("splitter"));

  const [wasm, rom] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}wasm/core.wasm`).then((r) => {
      if (!r.ok) throw new Error(`no se pudo descargar core.wasm (${r.status})`);
      return r.arrayBuffer();
    }),
    fetch(romUrl).then((r) => {
      if (!r.ok) throw new Error(`no se pudo descargar la ROM (${r.status})`);
      return r.arrayBuffer();
    }),
  ]);
  const core = await Core.load(wasm);
  core.loadRom(new Uint8Array(rom));

  const issue = loadPref("zx.issue") === "2" ? 2 : 3;
  core.x.zx_set_issue(issue);

  const canvas = $<HTMLCanvasElement>("screen");
  const display = new Display(canvas, core.framebuffer());
  const scaleSel = $<HTMLSelectElement>("emu-scale");
  const scale = parseScale(loadPref("zx.scale"));
  scaleSel.value = String(scale);
  display.setScale(scale);
  display.draw();

  const keys = new KeyState((row, bit, down) => core.x.zx_key(row, bit, down ? 1 : 0));
  attachKeyboard(canvas, keys);
  canvas.addEventListener("pointerdown", () => canvas.focus());

  const loop = new Loop(core);
  loop.events.on("frame", () => display.draw());

  // ---- Estado ----
  let audio: AudioOutLike | null = null;
  let audioState: "pending" | "on" | "off" = "pending";
  let muted = loadPref("zx.muted") === "1";
  let breakAt: number | null = null;

  const audioText = () =>
    audioState === "pending" ? "clic para sonido" : audioState === "off" ? "sin audio" : null;
  const renderStatus = (fps: number | null, audioMs: number | null) => {
    if (loop.isPaused) {
      status.textContent = breakAt !== null ? `Breakpoint en PC=${hex4(breakAt)}h` : "En pausa";
      return;
    }
    const parts = [fps === null ? "— fps" : `${fmt(fps, 1)} fps`];
    parts.push(audioMs !== null ? `audio ${fmt(audioMs, 0)} ms` : audioText() ?? "audio sin reloj");
    status.textContent = parts.join(" · ");
  };
  loop.events.on("stats", (s) => renderStatus(s.fps, s.audioMs));

  const pauseBtn = $<HTMLButtonElement>("emu-pause");
  loop.events.on("paused", (p) => {
    pauseBtn.textContent = p ? "Continuar" : "Pausa";
    pauseBtn.setAttribute("aria-pressed", String(p));
    if (!p) breakAt = null;
    renderStatus(null, null);
  });
  loop.events.on("breakpoint", () => {
    breakAt = core.regs.get16("pc");
    renderStatus(null, null);
  });

  // ---- Audio: arranca con el primer gesto del usuario ----
  const startAudio = async () => {
    const mod = audioModules["./emu/audio.ts"];
    if (!mod) { audioState = "off"; return; }
    try {
      const a = await (await mod()).AudioOut.create();
      await a.start();
      a.setMuted(muted);
      audio = a;
      loop.setAudio(a);
      audioState = "on";
      if (loop.isPaused) a.suspend().catch(() => {});
    } catch (e) {
      console.warn("audio no disponible:", e);
      audioState = "off";
    }
  };
  const gesture = () => {
    document.removeEventListener("pointerdown", gesture, true);
    document.removeEventListener("keydown", gesture, true);
    void startAudio();
  };
  document.addEventListener("pointerdown", gesture, true);
  document.addEventListener("keydown", gesture, true);

  // ---- Controles ----
  $("emu-reset").onclick = () => {
    core.x.zx_reset();
    display.draw();
    canvas.focus();
  };
  pauseBtn.onclick = () => loop.setPaused(!loop.isPaused);

  const issueSel = $<HTMLSelectElement>("emu-issue");
  issueSel.value = String(issue);
  issueSel.onchange = () => {
    core.x.zx_set_issue(Number(issueSel.value));
    savePref("zx.issue", issueSel.value);
  };

  scaleSel.onchange = () => {
    display.setScale(parseScale(scaleSel.value));
    savePref("zx.scale", scaleSel.value);
  };

  const muteBtn = $<HTMLButtonElement>("emu-mute");
  const renderMute = () => muteBtn.setAttribute("aria-pressed", String(muted));
  renderMute();
  muteBtn.onclick = () => {
    muted = !muted;
    audio?.setMuted(muted);
    savePref("zx.muted", muted ? "1" : "0");
    renderMute();
  };

  // ---- Ficheros: botón y arrastrar y soltar ----
  const openFile = async (file: File) => {
    let data: Uint8Array;
    try {
      data = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      showMessage(`No se pudo leer «${file.name}»: ${e}`, "error");
      return;
    }
    const r = loadFile(core, file.name, data);
    showMessage(r.message, r.ok ? "info" : "error");
    if (r.ok) {
      display.draw();
      canvas.focus();
    }
  };
  const fileInput = $<HTMLInputElement>("emu-file");
  $("emu-open").onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (f) void openFile(f);
  };
  // Guardar SNA (E1): el estado tal cual; zx_save_sna no altera la máquina.
  const snaBtn = $<HTMLButtonElement>("emu-save-sna");
  snaBtn.onclick = () => downloadBytes(core.saveSna(), stampedName("zxspectrum", "sna", new Date()));
  snaBtn.disabled = false;
  const wrap = $("screen-wrap");
  wrap.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    wrap.classList.add("dragover");
  });
  wrap.addEventListener("dragleave", (e) => {
    if (e.target === wrap) wrap.classList.remove("dragover");
  });
  wrap.addEventListener("drop", (e) => {
    e.preventDefault();
    wrap.classList.remove("dragover");
    const f = e.dataTransfer?.files[0];
    if (f) void openFile(f);
  });

  // ---- Ensamblar y ejecutar (I1). En pausa o parado en un breakpoint, se inyecta igual
  // y el bucle se reanuda: "ejecutar" significa correr. ----
  const runBtn = $<HTMLButtonElement>("asm-run");
  // ---- Depurador (D1 sobre pestañas, U1) ----
  const dbg = mountTabsDebugger({ host: $("debugger"), core, loop, tabs, say });
  dbgUi = dbg;
  /** Construye la pestaña que toca y la inyecta; null si no se pudo. */
  const build = () => {
    const target = runTarget();
    if (!target) return null;
    tabs.model.setMain(target.id);
    const r = buildAndRun(core, tabs.model, target);
    if (r.build.kind === "c" && r.build.ok) tabs.setGenerated(r.build.source);
    tabs.showDiags(r.diags);
    tabs.renderBar();
    showLog(r.messages);
    if (r.report && r.fin) dbg.programLoaded(r.report.asm, r.fin.srcMap, r.ok);
    if (!r.ok) return null;
    display.draw();
    return r;
  };
  const debugBtn = $<HTMLButtonElement>("asm-debug");
  debugBtn.onclick = () => {
    const r = build();
    if (!r) return;
    // Un programa C para en main (el crt0 no tiene líneas C); uno en ensamblador, en la entrada.
    const main = r.build.kind === "c" ? r.report!.asm.symbols.get("_main") : undefined;
    if (main !== undefined) dbg.runTo(main);
    else dbg.stopHere();
  };
  debugBtn.disabled = false;
  runProgram = () => {
    if (build()) loop.setPaused(false);
  };
  runBtn.onclick = () => { runProgram?.(); tabs.view.focus(); };
  runBtn.disabled = false;

  // ---- Pestaña oculta: pausa ----
  document.addEventListener("visibilitychange", () => loop.setHidden(document.hidden));
  loop.setHidden(document.hidden);

  renderStatus(null, null);
  loop.start();
}

boot().catch((e) => {
  status.textContent = "Error";
  showMessage(`Error al arrancar el emulador: ${e instanceof Error ? e.message : e}`, "error");
  console.error(e);
});
