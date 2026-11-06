// Editor de pantallas .scr: importar PNG (u otra imagen) y convertirla al formato del
// Spectrum, ver el resultado con o sin la rejilla de atributos, importar y exportar
// SCREEN$ crudos. La imagen original se conserva mientras la pestaña está abierta, para
// reconvertir al cambiar las opciones; lo que se guarda es sólo la pantalla convertida.
import { downloadBytes } from "../../export";
import {
  ATTR_SIZE, BITMAP_SIZE, SCR_H, SCR_SIZE, SCR_W, convertRgba, decodeScrDoc, emptyScr, encodeScrDoc, fitRect,
  scrToRgba, type FitMode,
} from "../../res/scr";
import type { ResourceEditor, ResourceIo } from "./index";

const ZOOM = 2;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createScrEditor(host: HTMLElement, io: ResourceIo, tabName: string): ResourceEditor {
  host.replaceChildren();
  const root = el("div", "res-scr");
  host.append(root);

  let scr: Uint8Array | null = null;
  let source: ImageBitmap | null = null;
  let grid = false;
  let destroyed = false;

  // ---- Barra ----
  const bar = el("div", "res-bar");
  const fileInput = el("input");
  fileInput.type = "file";
  fileInput.accept = "image/*,.scr";
  fileInput.hidden = true;
  const open = el("button", undefined, "Importar imagen o .scr…");
  open.type = "button";
  open.title = "PNG, GIF, JPG… se convierte al formato del Spectrum; un .scr de 6912 bytes se carga tal cual. También se puede soltar el fichero sobre el panel.";
  const fit = el("select");
  fit.title = "Cómo encaja la imagen en 256×192";
  for (const [v, t] of [["contain", "Ajustar (barras negras)"], ["cover", "Rellenar (recorta)"], ["stretch", "Estirar"]] as const) fit.append(new Option(t, v));
  const dither = el("select");
  dither.title = "Tramado ordenado 4×4: imita tonos intermedios con puntos";
  for (const [v, t] of [["bayer", "Tramado ordenado"], ["none", "Sin tramado"]] as const) dither.append(new Option(t, v));
  const gridBtn = el("button", undefined, "Rejilla 8×8");
  gridBtn.type = "button";
  gridBtn.setAttribute("aria-pressed", "false");
  const exportBtn = el("button", undefined, "Exportar .scr");
  exportBtn.type = "button";
  const clearBtn = el("button", undefined, "Vaciar");
  clearBtn.type = "button";
  bar.append(open, fit, dither, gridBtn, exportBtn, clearBtn, fileInput);

  // ---- Lienzo ----
  const wrap = el("div", "res-canvas-wrap");
  const canvas = el("canvas", "res-canvas");
  canvas.width = SCR_W;
  canvas.height = SCR_H;
  canvas.style.width = `${SCR_W * ZOOM}px`;
  canvas.style.height = `${SCR_H * ZOOM}px`;
  const overlay = el("canvas", "res-grid");
  overlay.width = SCR_W * ZOOM;
  overlay.height = SCR_H * ZOOM;
  const stack = el("div", "res-stack");
  stack.append(canvas, overlay);
  wrap.append(stack);
  const info = el("div", "res-info");
  const err = el("div", "res-error");
  err.hidden = true;
  root.append(bar, err, wrap, info);

  const ctx = canvas.getContext("2d")!;

  function drawGrid(): void {
    const g = overlay.getContext("2d")!;
    g.clearRect(0, 0, overlay.width, overlay.height);
    if (!grid) return;
    g.strokeStyle = "rgba(63,184,230,0.45)";
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 8; x < SCR_W; x += 8) { g.moveTo(x * ZOOM + 0.5, 0); g.lineTo(x * ZOOM + 0.5, overlay.height); }
    for (let y = 8; y < SCR_H; y += 8) { g.moveTo(0, y * ZOOM + 0.5); g.lineTo(overlay.width, y * ZOOM + 0.5); }
    g.stroke();
  }

  function render(): void {
    if (!scr) return;
    ctx.putImageData(new ImageData(scrToRgba(scr) as Uint8ClampedArray<ArrayBuffer>, SCR_W, SCR_H), 0, 0);
    drawGrid();
  }

  function setScr(next: Uint8Array, record: boolean): void {
    scr = next;
    render();
    if (record) io.setText(encodeScrDoc(next));
  }

  function load(): void {
    try {
      scr = decodeScrDoc(io.getText());
      err.hidden = true;
      wrap.hidden = false;
      render();
      info.textContent = `${SCR_W}×${SCR_H} · ${SCR_SIZE} bytes (bitmap ${BITMAP_SIZE} + atributos ${ATTR_SIZE}). En el código: INCBIN "${tabName}".`;
    } catch (e) {
      scr = null;
      wrap.hidden = true;
      err.hidden = false;
      err.replaceChildren(el("p", undefined, `El documento no es una pantalla válida: ${(e as Error).message}`));
      const reset = el("button", undefined, "Sustituir por una pantalla vacía");
      reset.type = "button";
      reset.onclick = () => { setScr(emptyScr(), true); load(); };
      err.append(reset);
    }
  }

  function convertSource(): void {
    if (!source) return;
    const c = document.createElement("canvas");
    c.width = SCR_W;
    c.height = SCR_H;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, SCR_W, SCR_H);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    const r = fitRect(source.width, source.height, fit.value as FitMode);
    g.drawImage(source, r.x, r.y, r.w, r.h);
    const out = convertRgba(g.getImageData(0, 0, SCR_W, SCR_H).data, { dither: dither.value as "none" | "bayer" });
    setScr(out, true);
    info.textContent = `Convertida desde una imagen de ${source.width}×${source.height}. Al cambiar las opciones se reconvierte.`;
  }

  async function importFile(f: File): Promise<void> {
    try {
      if (/\.scr$/i.test(f.name)) {
        const data = new Uint8Array(await f.arrayBuffer());
        if (data.length !== SCR_SIZE) { io.say(`«${f.name}»: un .scr tiene ${SCR_SIZE} bytes y éste ${data.length}.`); return; }
        source = null;
        setScr(data, true);
        info.textContent = `Cargado «${f.name}» (${SCR_SIZE} bytes).`;
      } else {
        const bmp = await createImageBitmap(f);
        if (destroyed) return;
        source = bmp;
        convertSource();
      }
    } catch {
      io.say(`«${f.name}»: no se puede leer como imagen ni como .scr.`);
    }
  }

  open.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (f) void importFile(f);
  };
  fit.onchange = convertSource;
  dither.onchange = convertSource;
  gridBtn.onclick = () => {
    grid = !grid;
    gridBtn.setAttribute("aria-pressed", String(grid));
    drawGrid();
  };
  exportBtn.onclick = () => {
    if (scr) downloadBytes(scr, tabName.replace(/\.[^.]*$/, "") + ".scr");
  };
  clearBtn.onclick = () => {
    if (!scr || !confirm("¿Vaciar la pantalla?")) return;
    source = null;
    setScr(emptyScr(), true);
    info.textContent = "Pantalla vacía.";
  };
  root.addEventListener("dragover", (e) => { e.preventDefault(); });
  root.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) void importFile(f);
  });
  canvas.addEventListener("mousemove", (e) => {
    if (!scr) return;
    const r = canvas.getBoundingClientRect();
    const x = Math.min(SCR_W - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * SCR_W)));
    const y = Math.min(SCR_H - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * SCR_H)));
    const a = scr[BITMAP_SIZE + (y >> 3) * 32 + (x >> 3)]!;
    info.textContent = `x ${x}, y ${y} · celda ${x >> 3},${y >> 3} · tinta ${a & 7} papel ${(a >> 3) & 7}${a & 0x40 ? " brillo" : ""}${a & 0x80 ? " parpadeo" : ""}`;
  });

  load();
  return { destroy() { destroyed = true; source?.close(); host.replaceChildren(); } };
}
