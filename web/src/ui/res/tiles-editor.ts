// Editor de tiles .tiles: paleta de tiles, lienzo de píxeles (clic izquierdo = tinta,
// derecho = papel, arrastrando), color por cuadro de 8×8, banderas con nombre, valor y
// nombre del tile, transformaciones e importación de una hoja de imagen. El documento es
// el de la pestaña; como este panel oculta CodeMirror, el deshacer es propio (Ctrl+Z / Ctrl+Y).
import { PALETTE, type ConvertOptions } from "../../res/scr";
import {
  DEFAULT_ATTR, MAX_TILES, emptyTile, flipH, flipHAttrs, flipV, flipVAttrs, invertPix, newTileSet, parseTileDoc,
  rotate90, rotate90Attrs, serializeTileSet, setPixel, shiftPix, tilesFromImage, type Tile, type TileSet, type TileSize,
} from "../../res/tiles";
import type { ResourceEditor, ResourceIo } from "./index";

const CANVAS = 256;
const rgb = (c: readonly [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(text: string, title: string, onclick: () => void): HTMLButtonElement {
  const b = el("button", undefined, text);
  b.type = "button";
  b.title = title;
  b.onclick = onclick;
  return b;
}
function field(label: string, input: HTMLElement): HTMLLabelElement {
  const l = el("label", "res-field");
  l.append(el("span", undefined, label), input);
  return l;
}

/** Dibuja un tile (con sus colores por cuadro) en un contexto, a escala `s` píxeles por píxel. */
function paintTile(ctx: CanvasRenderingContext2D, t: Tile, size: TileSize, s: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = t.atr[size === 16 ? (y >> 3) * 2 + (x >> 3) : 0]!;
      const br = (a >> 6) & 1;
      ctx.fillStyle = rgb(PALETTE[(t.pix[y]![x] === "X" ? a & 7 : (a >> 3) & 7) + 8 * br]!);
      ctx.fillRect(x * s, y * s, s, s);
    }
  }
}

export function createTilesEditor(host: HTMLElement, io: ResourceIo, tabName: string): ResourceEditor {
  host.replaceChildren();
  const root = el("div", "res-tiles");
  root.tabIndex = 0;
  host.append(root);

  let ts: TileSet | null = null;
  let sel = 0;
  let cell = 0;
  let allCells = false;
  const undo: string[] = [];
  const redo: string[] = [];
  const err = el("div", "res-error");
  err.hidden = true;

  // ---- Estructura ----
  const bar = el("div", "res-bar");
  const sizeSel = el("select");
  sizeSel.title = "Lado de los tiles. Sólo se puede cambiar mientras el conjunto tenga un único tile vacío.";
  sizeSel.append(new Option("8×8", "8"), new Option("16×16", "16"));
  const undoBtn = button("Deshacer", "Ctrl+Z", () => step(undo, redo));
  const redoBtn = button("Rehacer", "Ctrl+Y", () => step(redo, undo));
  const fileInput = el("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  const dither = el("select");
  dither.title = "Tramado al importar una hoja";
  dither.append(new Option("Sin tramado", "none"), new Option("Tramado ordenado", "bayer"));
  const importBtn = button("Importar hoja…", "Corta una imagen en tiles del tamaño del conjunto (sin cambiar de escala) y los añade al final.", () => fileInput.click());
  bar.append(field("Tamaño", sizeSel), undoBtn, redoBtn, importBtn, dither, fileInput);

  const main = el("div", "res-tiles-main");
  const list = el("div", "res-tile-list");
  const listBar = el("div", "res-bar");
  const palette = el("div", "res-tile-palette");
  list.append(listBar, palette);

  const center = el("div", "res-tile-center");
  const canvas = el("canvas", "res-tile-canvas");
  canvas.width = CANVAS;
  canvas.height = CANVAS;
  canvas.oncontextmenu = (e) => e.preventDefault();
  const tools = el("div", "res-bar");
  center.append(canvas, tools);

  const side = el("div", "res-tile-side");
  const info = el("div", "res-info");
  root.append(bar, err, main, info);
  main.append(list, center, side);

  // ---- Estado y cambios ----
  const cur = (): Tile => ts!.tiles[sel]!;
  const ctx = canvas.getContext("2d")!;

  function commit(before: string): void {
    const after = serializeTileSet(ts!);
    if (after === before) return;
    undo.push(before);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
    io.setText(after);
    refreshButtons();
  }
  /** Aplica `fn` al conjunto como un único paso de deshacer. */
  function change(fn: (t: TileSet) => void): void {
    const before = serializeTileSet(ts!);
    fn(ts!);
    commit(before);
    renderAll();
  }
  function step(from: string[], to: string[]): void {
    const prev = from.pop();
    if (prev === undefined || !ts) return;
    to.push(serializeTileSet(ts));
    ts = parseTileDoc(prev);
    sel = Math.min(sel, ts.tiles.length - 1);
    io.setText(prev);
    renderAll();
  }
  function refreshButtons(): void {
    undoBtn.disabled = undo.length === 0;
    redoBtn.disabled = redo.length === 0;
  }

  // ---- Dibujo ----
  function renderCanvas(): void {
    if (!ts) return;
    const size = ts.size, s = CANVAS / size;
    paintTile(ctx, cur(), size, s);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < size; i++) {
      ctx.moveTo(i * s + 0.5, 0); ctx.lineTo(i * s + 0.5, CANVAS);
      ctx.moveTo(0, i * s + 0.5); ctx.lineTo(CANVAS, i * s + 0.5);
    }
    ctx.stroke();
    if (size === 16) {
      ctx.strokeStyle = "rgba(63,184,230,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(CANVAS / 2, 0); ctx.lineTo(CANVAS / 2, CANVAS);
      ctx.moveTo(0, CANVAS / 2); ctx.lineTo(CANVAS, CANVAS / 2);
      ctx.stroke();
      ctx.strokeStyle = "#e6d23a";
      ctx.strokeRect((cell & 1) * (CANVAS / 2) + 1, (cell >> 1) * (CANVAS / 2) + 1, CANVAS / 2 - 2, CANVAS / 2 - 2);
    }
  }

  function renderPalette(): void {
    if (!ts) return;
    palette.replaceChildren();
    const size = ts.size, scale = size === 16 ? 2 : 4;
    ts.tiles.forEach((t, i) => {
      const b = el("button", "res-thumb");
      b.type = "button";
      b.setAttribute("aria-pressed", String(i === sel));
      b.title = `Tile ${i}${t.name ? ` · ${t.name}` : ""}${t.props ? ` · props ${t.props}` : ""}`;
      const c = el("canvas");
      c.width = size * scale;
      c.height = size * scale;
      paintTile(c.getContext("2d")!, t, size, scale);
      b.append(c, el("span", "res-thumb-n", String(i)));
      b.onclick = () => { sel = i; renderAll(); };
      palette.append(b);
    });
  }

  function colorRow(label: string, get: () => number, set: (v: number) => void): HTMLElement {
    const row = el("div", "res-colors");
    row.append(el("span", undefined, label));
    const br = (cur().atr[cell]! >> 6) & 1;
    for (let c = 0; c < 8; c++) {
      const b = el("button", "res-swatch");
      b.type = "button";
      b.style.background = rgb(PALETTE[c + 8 * br]!);
      b.title = `${label} ${c}`;
      b.setAttribute("aria-pressed", String(get() === c));
      b.onclick = () => set(c);
      row.append(b);
    }
    return row;
  }

  function setAttr(fn: (a: number) => number): void {
    change(() => {
      const t = cur();
      const idx = allCells ? t.atr.map((_, i) => i) : [cell];
      for (const i of idx) t.atr[i] = fn(t.atr[i]!) & 0x7f;
    });
  }

  function renderSide(): void {
    if (!ts) return;
    side.replaceChildren();
    const t = cur();
    const a = t.atr[cell]!;

    const colors = el("fieldset", "res-group");
    colors.append(el("legend", undefined, ts.size === 16 ? `Color del cuadro ${["arriba-izq.", "arriba-dcha.", "abajo-izq.", "abajo-dcha."][cell]}` : "Color"));
    colors.append(colorRow("Tinta", () => a & 7, (c) => setAttr((v) => (v & ~7) | c)));
    colors.append(colorRow("Papel", () => (a >> 3) & 7, (c) => setAttr((v) => (v & ~0x38) | (c << 3))));
    const bright = el("input");
    bright.type = "checkbox";
    bright.checked = !!(a & 0x40);
    bright.onchange = () => setAttr((v) => (bright.checked ? v | 0x40 : v & ~0x40));
    const lb = el("label", "res-check");
    lb.append(bright, document.createTextNode(" Brillo"));
    colors.append(lb);
    if (ts.size === 16) {
      const all = el("input");
      all.type = "checkbox";
      all.checked = allCells;
      all.onchange = () => { allCells = all.checked; };
      const la = el("label", "res-check");
      la.append(all, document.createTextNode(" Aplicar a los 4 cuadros"));
      colors.append(la);
    }
    side.append(colors);

    const props = el("fieldset", "res-group");
    props.append(el("legend", undefined, "Banderas (bits de props)"));
    ts.flags.forEach((name, i) => {
      const row = el("div", "res-flag");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!(t.props & (1 << i));
      cb.title = `Bit ${i} = ${1 << i}`;
      cb.onchange = () => change(() => { t.props = cb.checked ? t.props | (1 << i) : t.props & ~(1 << i); });
      const nm = el("input", "res-flag-name");
      nm.value = name;
      nm.title = "Nombre de la constante (letras, cifras y _). Se cambia para todo el conjunto.";
      nm.onchange = () => {
        const v = nm.value.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) || ts!.flags.some((f, j) => j !== i && f.toUpperCase() === v.toUpperCase())) {
          io.say(`«${v}» no vale como nombre de bandera (identificador, sin repetir).`);
          nm.value = ts!.flags[i]!;
          return;
        }
        change((s) => { s.flags[i] = v; });
      };
      row.append(cb, el("span", "res-flag-bit", String(i)), nm);
      props.append(row);
    });
    const val = el("input");
    val.type = "number"; val.min = "0"; val.max = "255";
    val.value = String(t.val);
    val.onchange = () => {
      const v = Math.round(Number(val.value));
      if (!(v >= 0 && v <= 255)) { io.say("El valor debe estar entre 0 y 255."); val.value = String(t.val); return; }
      change(() => { t.val = v; });
    };
    props.append(field("Valor (0-255)", val));
    const name = el("input");
    name.value = t.name;
    name.placeholder = "(sin nombre)";
    name.title = "Si lo tiene, el .inc define <conjunto>_T_<NOMBRE> con el índice del tile.";
    name.onchange = () => {
      const v = name.value.trim();
      const dup = ts!.tiles.some((o, j) => j !== sel && v !== "" && o.name.toUpperCase() === v.toUpperCase());
      if ((v !== "" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) || dup) {
        io.say(`«${v}» no vale como nombre de tile (identificador, sin repetir).`);
        name.value = t.name;
        return;
      }
      change(() => { t.name = v; });
    };
    props.append(field("Nombre", name));
    side.append(props);

    const use = el("div", "res-info");
    const base = tabName.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_]/g, "_");
    use.textContent = `En el código: INCLUDE "${tabName}#inc" y INCBIN "${tabName}" (gráficos), "${tabName}#attr", "${tabName}#props", "${tabName}#val". Constantes: ${base}_COUNT, ${base}_SOLID…`;
    side.append(use);
  }

  function renderList(): void {
    if (!ts) return;
    listBar.replaceChildren(
      button("＋", "Tile nuevo (vacío) detrás del seleccionado", () => {
        if (ts!.tiles.length >= MAX_TILES) { io.say(`Máximo ${MAX_TILES} tiles.`); return; }
        change((s) => { s.tiles.splice(sel + 1, 0, emptyTile(s.size, cur().atr[0] ?? DEFAULT_ATTR)); sel++; });
      }),
      button("⧉", "Duplicar el tile", () => {
        if (ts!.tiles.length >= MAX_TILES) { io.say(`Máximo ${MAX_TILES} tiles.`); return; }
        change((s) => { const t = cur(); s.tiles.splice(sel + 1, 0, { ...t, pix: [...t.pix], atr: [...t.atr], name: "" }); sel++; });
      }),
      button("🗑", "Borrar el tile (el último no se borra)", () => {
        if (ts!.tiles.length <= 1) { io.say("Un conjunto necesita al menos un tile."); return; }
        change((s) => { s.tiles.splice(sel, 1); sel = Math.min(sel, s.tiles.length - 1); });
      }),
      button("◀", "Mover a la izquierda (cambia los índices)", () => {
        if (sel === 0) return;
        change((s) => { const [t] = s.tiles.splice(sel, 1); s.tiles.splice(sel - 1, 0, t!); sel--; });
      }),
      button("▶", "Mover a la derecha (cambia los índices)", () => {
        if (sel >= ts!.tiles.length - 1) return;
        change((s) => { const [t] = s.tiles.splice(sel, 1); s.tiles.splice(sel + 1, 0, t!); sel++; });
      }),
    );
  }

  function renderTools(): void {
    const edit = (f: (t: Tile) => void) => () => change(() => f(cur()));
    tools.replaceChildren(
      button("↔", "Reflejar horizontalmente", edit((t) => { t.pix = flipH(t.pix); t.atr = flipHAttrs(t.atr); })),
      button("↕", "Reflejar verticalmente", edit((t) => { t.pix = flipV(t.pix); t.atr = flipVAttrs(t.atr); })),
      button("⟳", "Girar 90° a la derecha", edit((t) => { t.pix = rotate90(t.pix); t.atr = rotate90Attrs(t.atr); })),
      button("◐", "Invertir tinta y papel", edit((t) => { t.pix = invertPix(t.pix); })),
      button("←", "Desplazar 1 píxel a la izquierda (con vuelta)", edit((t) => { t.pix = shiftPix(t.pix, -1, 0); })),
      button("→", "Desplazar 1 píxel a la derecha (con vuelta)", edit((t) => { t.pix = shiftPix(t.pix, 1, 0); })),
      button("↑", "Desplazar 1 píxel arriba (con vuelta)", edit((t) => { t.pix = shiftPix(t.pix, 0, -1); })),
      button("↓", "Desplazar 1 píxel abajo (con vuelta)", edit((t) => { t.pix = shiftPix(t.pix, 0, 1); })),
      button("Limpiar", "Todo papel", edit((t) => { t.pix = emptyTile(ts!.size).pix; })),
    );
  }

  function renderAll(): void {
    if (!ts) return;
    const blank = ts.tiles.length === 1 && ts.tiles[0]!.pix.every((r) => !r.includes("X")) && ts.tiles[0]!.props === 0 && ts.tiles[0]!.val === 0;
    sizeSel.value = String(ts.size);
    sizeSel.disabled = !blank;
    renderList();
    renderPalette();
    renderCanvas();
    renderSide();
    refreshButtons();
    info.textContent = `${ts.tiles.length} tile${ts.tiles.length === 1 ? "" : "s"} de ${ts.size}×${ts.size} · ${ts.tiles.length * ts.size * (ts.size >> 3)} bytes de gráficos`;
  }

  // ---- Pintar con el ratón ----
  let stroke: { before: string; ink: boolean } | null = null;
  function pixelAt(e: PointerEvent): [number, number] {
    const r = canvas.getBoundingClientRect(), size = ts!.size;
    const x = Math.min(size - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * size)));
    const y = Math.min(size - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * size)));
    return [x, y];
  }
  /** Último píxel pintado del trazo: un movimiento rápido salta píxeles, así que se rellena la recta. */
  let last: [number, number] | null = null;
  function paint(e: PointerEvent): void {
    if (!stroke) return;
    const [x, y] = pixelAt(e);
    let [x0, y0] = last ?? [x, y];
    const dx = Math.abs(x - x0), dy = -Math.abs(y - y0), sx = x0 < x ? 1 : -1, sy = y0 < y ? 1 : -1;
    let err = dx + dy;
    for (;;) { // Bresenham
      cur().pix = setPixel(cur().pix, x0, y0, stroke.ink);
      if (x0 === x && y0 === y) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    last = [x, y];
    renderCanvas();
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (!ts || (e.button !== 0 && e.button !== 2)) return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = pixelAt(e);
    if (ts.size === 16) {
      const c = (y >> 3) * 2 + (x >> 3);
      if (c !== cell) { cell = c; renderSide(); }
    }
    stroke = { before: serializeTileSet(ts), ink: e.button === 0 };
    last = null;
    paint(e);
  });
  canvas.addEventListener("pointermove", paint);
  const end = () => {
    if (!stroke || !ts) return;
    const s = stroke;
    stroke = null;
    last = null;
    commit(s.before);
    renderPalette();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  // ---- Controles ----
  sizeSel.onchange = () => {
    if (!ts) return;
    const size = Number(sizeSel.value) as TileSize;
    cell = 0;
    change((s) => { const n = newTileSet(size); s.size = n.size; s.tiles = n.tiles; sel = 0; });
  };
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f || !ts) return;
    try {
      const bmp = await createImageBitmap(f);
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      const data = g.getImageData(0, 0, bmp.width, bmp.height).data;
      bmp.close();
      const added = tilesFromImage(data, bmp.width, bmp.height, ts.size, { dither: dither.value as ConvertOptions["dither"] });
      const room = MAX_TILES - ts.tiles.length;
      if (room <= 0) { io.say(`El conjunto ya tiene ${MAX_TILES} tiles.`); return; }
      const first = ts.tiles.length;
      change((s) => {
        // Un conjunto con un único tile vacío se sustituye en lugar de dejarlo delante.
        const only = s.tiles.length === 1 && s.tiles[0]!.pix.every((r) => !r.includes("X"));
        if (only) s.tiles = [];
        s.tiles.push(...added.slice(0, room));
        sel = only ? 0 : first;
      });
      io.say(`${Math.min(added.length, room)} tiles importados${added.length > room ? ` (se omiten ${added.length - room}: máximo ${MAX_TILES})` : ""}.`);
    } catch (e) {
      io.say(`«${f.name}»: ${e instanceof Error && e.message ? e.message : "no se puede leer como imagen"}.`);
    }
  };
  root.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest("input, select")) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); step(undo, redo); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); step(redo, undo); }
  });
  root.addEventListener("dragover", (e) => e.preventDefault());
  root.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) { const dt = new DataTransfer(); dt.items.add(f); fileInput.files = dt.files; void fileInput.onchange?.(new Event("change")); }
  });

  // ---- Arranque ----
  renderTools();
  try {
    ts = parseTileDoc(io.getText());
    renderAll();
  } catch (e) {
    main.hidden = true;
    bar.hidden = true;
    err.hidden = false;
    err.replaceChildren(el("p", undefined, `El documento no es un conjunto de tiles válido: ${(e as Error).message}`));
    err.append(button("Sustituir por un conjunto vacío", "Pierde el contenido actual de la pestaña", () => {
      io.setText(serializeTileSet(newTileSet(16)));
      createTilesEditor(host, io, tabName);
    }));
  }
  return { destroy() { host.replaceChildren(); } };
}
