// Editor de mapas .map: cuadrícula de celdas con el aspecto del conjunto .tiles ligado, pincel
// (arrastrando), rectángulo, relleno, cuentagotas (clic derecho) y capa de marcadores. El documento
// es el de la pestaña; como este panel oculta CodeMirror, el deshacer es propio (Ctrl+Z / Ctrl+Y).
import { MAX_DIM, MAX_MARKS, fillRect, floodFill, maxTileUsed, newMap, parseMapDoc, resizeMap, serializeMap, setMarker, type MapDoc } from "../../res/map";
import { parseTileDoc, type TileSet } from "../../res/tiles";
import { button, el, field, paintTile, tileCanvas } from "./draw";
import type { ResourceEditor, ResourceIo } from "./index";

type Tool = "brush" | "rect" | "fill" | "mark";
const TOOLS: Array<[Tool, string, string]> = [
  ["brush", "Pincel", "Clic izquierdo pinta arrastrando; clic derecho recoge el tile de la celda"],
  ["rect", "Rectángulo", "Arrastra para rellenar un rectángulo"],
  ["fill", "Relleno", "Rellena la región del mismo tile"],
  ["mark", "Marcadores", "Clic izquierdo pone el marcador del tipo elegido; clic derecho lo quita"],
];
/** Límites del lienzo: lado y área en píxeles, por debajo de lo que aceptan los navegadores. */
const MAX_SIDE = 8192, MAX_AREA = 16 * 1024 * 1024;

export function createMapEditor(host: HTMLElement, io: ResourceIo, tabName: string): ResourceEditor {
  host.replaceChildren();
  const root = el("div", "res-map");
  root.tabIndex = 0;
  host.append(root);

  let m: MapDoc | null = null;
  let set: TileSet | null = null;
  let thumbs: HTMLCanvasElement[] = [];
  let tool: Tool = "brush";
  let sel = 0;
  let markKind = 1;
  let zoom = 2;
  let cs = 16; // píxeles de una celda en el lienzo
  const undo: string[] = [];
  const redo: string[] = [];
  const err = el("div", "res-error");
  err.hidden = true;

  // ---- Estructura ----
  const bar = el("div", "res-bar");
  const tilesSel = el("select");
  tilesSel.title = "Conjunto .tiles que da el aspecto a las celdas";
  const wIn = el("input"), hIn = el("input");
  for (const i of [wIn, hIn]) { i.type = "number"; i.min = "1"; i.max = String(MAX_DIM); }
  const resizeBtn = button("Aplicar tamaño", "Conserva lo que cabe (ancla arriba-izquierda); lo nuevo se rellena con el tile elegido", () => doResize());
  const zoomSel = el("select");
  zoomSel.title = "Ampliación";
  for (const z of [1, 2, 3, 4]) zoomSel.append(new Option(`×${z}`, String(z)));
  zoomSel.value = String(zoom);
  const undoBtn = button("Deshacer", "Ctrl+Z", () => step(undo, redo));
  const redoBtn = button("Rehacer", "Ctrl+Y", () => step(redo, undo));
  bar.append(field("Tiles", tilesSel), field("Ancho", wIn), field("Alto", hIn), resizeBtn, field("Zoom", zoomSel), undoBtn, redoBtn);

  const toolBar = el("div", "res-bar");
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  for (const [t, label, title] of TOOLS) {
    const b = button(label, title, () => { tool = t; renderTools(); });
    toolBtns.set(t, b);
    toolBar.append(b);
  }
  const kindIn = el("input");
  kindIn.type = "number"; kindIn.min = "0"; kindIn.max = "255"; kindIn.value = String(markKind);
  kindIn.title = "Tipo (0-255) del marcador que se pone";
  kindIn.oninput = () => { markKind = Math.max(0, Math.min(255, Math.floor(Number(kindIn.value)) || 0)); };
  const kindField = field("Tipo", kindIn);
  toolBar.append(kindField);

  const palette = el("div", "res-tile-palette");
  const idxIn = el("input");
  idxIn.type = "number"; idxIn.min = "0"; idxIn.max = "255";
  idxIn.oninput = () => { sel = Math.max(0, Math.min(255, Math.floor(Number(idxIn.value)) || 0)); };
  const idxField = field("Tile", idxIn);

  const wrap = el("div", "res-canvas-wrap");
  const stack = el("div", "res-stack");
  const canvas = el("canvas", "res-canvas");
  canvas.oncontextmenu = (e) => e.preventDefault();
  canvas.style.touchAction = "none";
  stack.append(canvas);
  wrap.append(stack);
  const info = el("div", "res-info");
  root.append(bar, err, toolBar, palette, idxField, wrap, info);
  const ctx = canvas.getContext("2d")!;

  // ---- Cambios ----
  function commit(before: string): void {
    const after = serializeMap(m!);
    if (after === before) return;
    undo.push(before);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
    io.setText(after);
    refreshButtons();
  }
  function step(from: string[], to: string[]): void {
    const prev = from.pop();
    if (prev === undefined || !m) return;
    to.push(serializeMap(m));
    m = parseMapDoc(prev);
    io.setText(prev);
    syncInputs();
    renderAll();
  }
  function refreshButtons(): void {
    undoBtn.disabled = undo.length === 0;
    redoBtn.disabled = redo.length === 0;
  }
  function doResize(): void {
    const w = Math.floor(Number(wIn.value)), h = Math.floor(Number(hIn.value));
    if (!(w >= 1 && w <= MAX_DIM && h >= 1 && h <= MAX_DIM)) { io.say(`El tamaño debe estar entre 1 y ${MAX_DIM}.`); syncInputs(); return; }
    const before = serializeMap(m!);
    m = resizeMap(m!, w, h, sel);
    commit(before);
    renderAll();
  }

  // ---- Datos ligados ----
  function loadSet(): void {
    set = null;
    thumbs = [];
    const text = m!.tiles ? io.textOf(m!.tiles) : undefined;
    if (text === undefined) return;
    try {
      set = parseTileDoc(text);
      thumbs = set.tiles.map((t) => tileCanvas(t, set!.size));
    } catch { set = null; }
  }
  function fillTilesSelect(): void {
    tilesSel.replaceChildren(new Option("(ninguno)", ""));
    const names = io.listTabs("tiles");
    if (m!.tiles && !names.includes(m!.tiles)) names.unshift(m!.tiles); // enlace roto: se conserva visible
    for (const n of names) tilesSel.append(new Option(n, n));
    tilesSel.value = m!.tiles;
  }
  tilesSel.onchange = () => {
    const before = serializeMap(m!);
    m!.tiles = tilesSel.value;
    commit(before);
    loadSet();
    renderAll();
  };
  zoomSel.onchange = () => { zoom = Number(zoomSel.value); renderAll(); };

  function syncInputs(): void {
    wIn.value = String(m!.w);
    hIn.value = String(m!.h);
    idxIn.value = String(sel);
  }

  // ---- Dibujo ----
  function cellSize(): number {
    const base = set ? set.size : 16;
    let z = zoom;
    while (z > 1 && (m!.w * base * z > MAX_SIDE || m!.h * base * z > MAX_SIDE || m!.w * m!.h * (base * z) ** 2 > MAX_AREA)) z--;
    return base * z;
  }
  function drawCell(c: number, r: number): void {
    const v = m!.data[r]![c]!, x = c * cs, y = r * cs;
    const t = thumbs[v];
    if (t) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(t, x, y, cs, cs);
    } else {
      ctx.fillStyle = set ? "#6a1f1f" : "#2b2f37"; // índice fuera del conjunto: rojo oscuro
      ctx.fillRect(x, y, cs, cs);
      if (cs >= 12) {
        ctx.fillStyle = "#c9ccd2";
        ctx.font = `${Math.max(9, cs >> 1)}px ui-monospace, monospace`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(String(v), x + cs / 2, y + cs / 2);
      }
    }
    const k = m!.marks.find((q) => q.c === c && q.r === r);
    if (k) {
      const d = Math.max(6, cs >> 1);
      ctx.fillStyle = "#e6d23a";
      ctx.fillRect(x + 1, y + 1, d, d);
      ctx.fillStyle = "#000";
      ctx.font = `bold ${Math.max(7, d - 2)}px ui-monospace, monospace`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(String(k.k), x + 2, y + 2);
    }
  }
  function renderCanvas(): void {
    cs = cellSize();
    canvas.width = m!.w * cs;
    canvas.height = m!.h * cs;
    for (let r = 0; r < m!.h; r++) for (let c = 0; c < m!.w; c++) drawCell(c, r);
    if (cs >= 8) {
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 1; c < m!.w; c++) { ctx.moveTo(c * cs + 0.5, 0); ctx.lineTo(c * cs + 0.5, canvas.height); }
      for (let r = 1; r < m!.h; r++) { ctx.moveTo(0, r * cs + 0.5); ctx.lineTo(canvas.width, r * cs + 0.5); }
      ctx.stroke();
    }
  }
  function renderPalette(): void {
    palette.replaceChildren();
    idxField.hidden = !!set;
    palette.hidden = !set;
    if (!set) return;
    const scale = set.size === 16 ? 2 : 4;
    set.tiles.forEach((t, i) => {
      const b = el("button", "res-thumb");
      b.type = "button";
      b.setAttribute("aria-pressed", String(i === sel));
      b.title = `Tile ${i}${t.name ? ` · ${t.name}` : ""}`;
      const c = el("canvas");
      c.width = set!.size * scale;
      c.height = set!.size * scale;
      paintTile(c.getContext("2d")!, t, set!.size, scale);
      b.append(el("span", "res-thumb-n", String(i)));
      b.prepend(c);
      b.onclick = () => { sel = i; idxIn.value = String(i); renderPalette(); };
      palette.append(b);
    });
  }
  function renderTools(): void {
    for (const [t, b] of toolBtns) b.setAttribute("aria-pressed", String(t === tool));
    kindField.hidden = tool !== "mark";
  }
  function renderInfo(extra = ""): void {
    const used = maxTileUsed(m!);
    const warn = set && used >= set.tiles.length ? ` · AVISO: el mapa usa el tile ${used} y «${m!.tiles}» sólo tiene ${set.tiles.length}` : "";
    const link = m!.tiles && !set ? ` · AVISO: no hay una pestaña «${m!.tiles}» válida` : "";
    info.textContent = `${m!.w}×${m!.h} celdas · ${m!.marks.length}/${MAX_MARKS} marcadores${warn}${link}${extra ? " · " + extra : ""}`;
  }
  function renderAll(): void {
    renderCanvas();
    renderPalette();
    renderTools();
    renderInfo();
    refreshButtons();
  }

  // ---- Ratón ----
  const cellAt = (e: PointerEvent): [number, number] | null => {
    const b = canvas.getBoundingClientRect();
    const c = Math.floor(((e.clientX - b.left) / b.width) * m!.w), r = Math.floor(((e.clientY - b.top) / b.height) * m!.h);
    return c >= 0 && r >= 0 && c < m!.w && r < m!.h ? [c, r] : null;
  };
  let drag: { before: string; erase: boolean; c0: number; r0: number; c: number; r: number } | null = null;

  /** Pinta la celda; devuelve true si cambia. */
  function brushCell(c: number, r: number, erase: boolean): void {
    if (tool === "mark") {
      if (erase) setMarker(m!, c, r, null);
      else if (!setMarker(m!, c, r, markKind)) io.say(`Máximo de ${MAX_MARKS} marcadores.`);
    } else if (!erase) m!.data[r]![c] = sel;
    drawCell(c, r);
  }
  /** Bresenham entre celdas, para que un arrastre rápido no deje huecos. */
  function line(c0: number, r0: number, c1: number, r1: number, erase: boolean): void {
    const dx = Math.abs(c1 - c0), dy = -Math.abs(r1 - r0), sx = c0 < c1 ? 1 : -1, sy = r0 < r1 ? 1 : -1;
    let err2 = dx + dy;
    for (let c = c0, r = r0; ;) {
      brushCell(c, r, erase);
      if (c === c1 && r === r1) break;
      const e2 = 2 * err2;
      if (e2 >= dy) { err2 += dy; c += sx; }
      if (e2 <= dx) { err2 += dx; r += sy; }
    }
  }
  function previewRect(): void {
    if (!drag) return;
    renderCanvas();
    ctx.strokeStyle = "#e6d23a";
    ctx.lineWidth = 2;
    const x0 = Math.min(drag.c0, drag.c), y0 = Math.min(drag.r0, drag.r);
    ctx.strokeRect(x0 * cs + 1, y0 * cs + 1, (Math.abs(drag.c - drag.c0) + 1) * cs - 2, (Math.abs(drag.r - drag.r0) + 1) * cs - 2);
  }

  canvas.addEventListener("pointerdown", (e) => {
    const p = cellAt(e);
    if (!p || !m) return;
    e.preventDefault();
    root.focus();
    const [c, r] = p;
    const erase = e.button === 2;
    if (erase && tool !== "mark") { // cuentagotas
      sel = m.data[r]![c]!;
      idxIn.value = String(sel);
      renderPalette();
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    drag = { before: serializeMap(m), erase, c0: c, r0: r, c, r };
    if (tool === "fill") {
      floodFill(m, c, r, sel);
      renderCanvas();
    } else if (tool === "brush" || tool === "mark") brushCell(c, r, erase);
    else previewRect();
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = cellAt(e);
    if (p && m) {
      const v = m.data[p[1]]![p[0]]!, k = m.marks.find((q) => q.c === p[0] && q.r === p[1]);
      renderInfo(`(${p[0]}, ${p[1]}) tile ${v}${k ? ` · marcador ${k.k}` : ""}`);
    }
    if (!drag || !p || !m) return;
    const [c, r] = p;
    if (c === drag.c && r === drag.r) return;
    if (tool === "brush" || tool === "mark") line(drag.c, drag.r, c, r, drag.erase);
    drag.c = c;
    drag.r = r;
    if (tool === "rect") previewRect();
  });
  const end = (): void => {
    if (!drag || !m) return;
    if (tool === "rect") fillRect(m, drag.c0, drag.r0, drag.c, drag.r, sel);
    const before = drag.before;
    drag = null;
    commit(before);
    renderAll();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  root.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest("input, select")) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); step(undo, redo); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); step(redo, undo); }
  });

  // ---- Arranque ----
  try {
    m = parseMapDoc(io.getText());
    // Un mapa nuevo se liga solo al primer conjunto de tiles si hay uno.
    if (!m.tiles) {
      const first = io.listTabs("tiles")[0];
      if (first) { m.tiles = first; io.setText(serializeMap(m)); }
    }
    fillTilesSelect();
    loadSet();
    syncInputs();
    renderAll();
  } catch (e) {
    for (const x of [bar, toolBar, palette, idxField, wrap, info]) x.hidden = true;
    err.hidden = false;
    err.replaceChildren(el("p", undefined, `El documento no es un mapa válido: ${(e as Error).message}`));
    err.append(button("Sustituir por un mapa vacío", "Pierde el contenido actual de la pestaña", () => {
      io.setText(serializeMap(newMap(32, 24)));
      createMapEditor(host, io, tabName);
    }));
  }
  return { destroy() { host.replaceChildren(); } };
}
