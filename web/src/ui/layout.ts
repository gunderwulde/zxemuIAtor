// Divisor arrastrable entre el IDE (izquierda) y el emulador, y preferencias en
// localStorage (que puede no existir o lanzar: modo privado, cookies bloqueadas…).

export function loadPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function savePref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* sin persistencia */ }
}

const IDE_WIDTH_KEY = "zx.ideWidth";
const MIN_IDE = 260;
const MIN_EMU = 360;

/** El ancho del IDE vive en la variable CSS --ide-w de .app. */
export function initSplitter(app: HTMLElement, splitter: HTMLElement): void {
  const clamp = (w: number) => Math.round(Math.max(MIN_IDE, Math.min(w, app.clientWidth - MIN_EMU)));
  const apply = (w: number) => app.style.setProperty("--ide-w", `${w}px`);
  const current = () => (app.firstElementChild as HTMLElement).getBoundingClientRect().width;

  const saved = Number(loadPref(IDE_WIDTH_KEY));
  if (saved > 0) apply(clamp(saved));

  let dragging = false;
  splitter.addEventListener("pointerdown", (e) => {
    dragging = true;
    splitter.setPointerCapture(e.pointerId);
    app.classList.add("resizing");
    e.preventDefault();
  });
  splitter.addEventListener("pointermove", (e) => {
    if (dragging) apply(clamp(e.clientX - app.getBoundingClientRect().left));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    app.classList.remove("resizing");
    savePref(IDE_WIDTH_KEY, String(Math.round(current())));
  };
  splitter.addEventListener("pointerup", end);
  splitter.addEventListener("pointercancel", end);
  splitter.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const w = clamp(current() + (e.key === "ArrowLeft" ? -step : step));
    apply(w);
    savePref(IDE_WIDTH_KEY, String(w));
    e.preventDefault();
  });
  splitter.addEventListener("dblclick", () => {
    app.style.removeProperty("--ide-w");
    savePref(IDE_WIDTH_KEY, "");
  });
  // Si la ventana se estrecha, el emulador conserva su mínimo.
  window.addEventListener("resize", () => {
    if (app.style.getPropertyValue("--ide-w")) apply(clamp(current()));
  });
}
