// Composición de la web: núcleo, pantalla, teclado, bucle, audio, ficheros y controles.
import romUrl from "../../rom/48.rom?url";
import { Core } from "./emu/core";
import { Display, parseScale } from "./emu/display";
import { KeyState, attachKeyboard } from "./emu/input";
import { Loop, type LoopAudio } from "./emu/loop";
import { loadFile } from "./ui/files";
import { initSplitter, loadPref, savePref } from "./ui/layout";
import { attachExamples, mountEditor } from "./ui/editor";
import { assembleAndRun, type RunMessage } from "./ui/run";
import { mountDebugger } from "./ui/debugger";
import { downloadBytes, exportSourceTap, stampedName } from "./export";

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

// ---- IDE (I1): se monta antes que el núcleo, así se puede editar aunque éste falle ----
const asmLog = $<HTMLPreElement>("asm-log");
function showLog(lines: RunMessage[]): void {
  asmLog.replaceChildren(...lines.map((m) => {
    const s = document.createElement("span");
    s.className = m.severity;
    s.textContent = m.text + "\n";
    return s;
  }));
}
let runProgram: (() => void) | null = null;
const editor = mountEditor($("editor"), { onRun: () => runProgram?.() });
attachExamples($<HTMLSelectElement>("asm-example"), editor, (title) =>
  showLog([{ severity: "info", text: `Cargado el ejemplo «${title}» (Ctrl+Z lo deshace). Ctrl+Enter para ejecutarlo.` }]));

// ---- Exportar TAP (E1): sólo ensambla, no necesita el núcleo ----
$("asm-export-tap").onclick = () => {
  const r = exportSourceTap(editor.source(), "programa");
  editor.showErrors(r.asm.errors);
  showLog(r.messages);
  if (r.tap) downloadBytes(r.tap, stampedName("programa", "tap", new Date()));
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
  // ---- Depurador (D1) ----
  const dbgUi = mountDebugger({
    host: $("debugger"), core, loop, view: editor.view,
    say: (text) => showLog([{ severity: "info", text }]),
  });
  const debugBtn = $<HTMLButtonElement>("asm-debug");
  debugBtn.onclick = () => {
    const r = assembleAndRun(core, editor.source());
    editor.showErrors(r.asm.errors);
    showLog(r.messages);
    dbgUi.programLoaded(r.asm, r.ok);
    if (!r.ok) return;
    display.draw();
    dbgUi.stopHere();
  };
  debugBtn.disabled = false;
  runProgram = () => {
    const r = assembleAndRun(core, editor.source());
    editor.showErrors(r.asm.errors);
    showLog(r.messages);
    dbgUi.programLoaded(r.asm, r.ok);
    if (!r.ok) return;
    display.draw();
    loop.setPaused(false);
  };
  runBtn.onclick = () => { runProgram?.(); editor.view.focus(); };
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
