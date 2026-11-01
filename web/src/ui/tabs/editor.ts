// U1: editor con pestañas (DOM). Un único EditorView y un EditorState por pestaña: al
// cambiar de pestaña se guarda el estado de la que se deja y se pone el de la nueva
// (view.setState), así cada una conserva su historial de deshacer, cursor, breakpoints y
// diagnósticos. Toda la lógica de pestañas está en model.ts (sin DOM, con tests).
import { EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, highlightSpecialChars,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, insertTab } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, linter, lintGutter, lintKeymap, setDiagnostics } from "@codemirror/lint";
import { assemble } from "../../asm";
import { CLIB_FILES, clibResolve } from "../../clib";
import { highlight, theme } from "../editor";
import { toDiagnostics } from "../editor/diagnostics";
import { z80Language } from "../editor/z80lang";
import { bpLinesEffect, bpLinesOf, currentLineEffect, debugExtension, toggleBpAtCursor } from "../debugger/editor-ext";
import { type TabDiag, prepare } from "./build";
import { cLanguage } from "./clang";
import { GEN_NAME, type Prefs, type Tab, type TabKind, TabsModel, hasMain, kindOf, langOf, libTabName } from "./model";

const SAVE_DELAY = 400;
const LINT_DELAY = 500;

export interface TabsEditorOptions {
  /** Contenedor de la barra de pestañas (se vacía). */
  bar: HTMLElement;
  /** Contenedor del EditorView (se vacía). */
  host: HTMLElement;
  prefs: Prefs;
  defaults: { asm: string; c: string };
  /** Ctrl+Enter / Cmd+Enter. */
  onRun(): void;
  /** Mensaje corto para el usuario (errores de nombre, etc.). */
  say(text: string): void;
  /** Algún breakpoint del margen ha podido cambiar (en cualquier pestaña). */
  onBpsChanged(): void;
  /** Se ha activado otra pestaña. */
  onSwitch?(tab: Tab): void;
}

function toCm(state: EditorState, diags: readonly TabDiag[], source: string): Diagnostic[] {
  return toDiagnostics(state.doc, diags).map((d) => ({ ...d, source }));
}

export class TabsEditor {
  readonly model: TabsModel;
  readonly view: EditorView;
  private states = new Map<number, EditorState>();
  private scrolls = new Map<number, number>();
  private current = new Map<number, number | null>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private dragId: number | null = null;

  constructor(private o: TabsEditorOptions) {
    this.model = TabsModel.load(o.prefs, o.defaults);
    o.host.replaceChildren();
    // La activa vive en la vista; las demás, en this.states.
    this.view = new EditorView({ parent: o.host, state: this.takeStored(this.model.active!) });
    this.renderBar();
  }

  // ---- Estados ----

  private extensions(tab: Tab): Extension[] {
    const lang = langOf(tab);
    const ro = tab.ro !== undefined;
    const ext: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      EditorState.tabSize.of(lang === "z80" ? 8 : 4),
      lang === "z80" ? z80Language : cLanguage,
      syntaxHighlighting(highlight),
      theme,
      lintGutter(),
      keymap.of([
        { key: "Mod-Enter", run: () => { this.o.onRun(); return true; }, preventDefault: true },
        ...(ro ? [] : [{ key: "Tab", run: insertTab }]),
        ...defaultKeymap, ...historyKeymap, ...lintKeymap,
      ]),
      debugExtension(() => this.o.onBpsChanged()),
      EditorView.contentAttributes.of(() => ({
        "aria-label": `${tab.name}${ro ? " (sólo lectura)" : ""}`, spellcheck: "false", autocapitalize: "off",
      })),
    ];
    if (ro) {
      ext.push(EditorState.readOnly.of(true));
    } else {
      ext.push(
        linter((v) => this.lint(tab, v.state), { delay: LINT_DELAY }),
        EditorView.updateListener.of((u) => { if (u.docChanged) this.scheduleSave(); }),
      );
    }
    return ext;
  }

  /** Estado actual de la pestaña: el de la vista si es la activa. */
  private stateOf(tab: Tab): EditorState {
    if (tab.id === this.model.activeId && this.view) return this.view.state;
    return this.stored(tab);
  }

  /** Estado guardado (o nuevo) de una pestaña que no está en la vista; se saca del mapa. */
  private takeStored(tab: Tab): EditorState {
    const s = this.stored(tab);
    this.states.delete(tab.id);
    return s;
  }

  private stored(tab: Tab): EditorState {
    let s = this.states.get(tab.id);
    if (!s) {
      s = EditorState.create({ doc: tab.text, extensions: this.extensions(tab) });
      this.states.set(tab.id, s);
    }
    return s;
  }

  /** Aplica efectos/diagnósticos a una pestaña, esté o no a la vista. */
  private updateTab(tab: Tab, spec: TransactionSpec): void {
    if (tab.id === this.model.activeId) this.view.dispatch(spec);
    else this.states.set(tab.id, this.stateOf(tab).update(spec).state);
  }

  /** Copia al modelo el texto de cada pestaña (el editor es la fuente de verdad mientras se edita). */
  flush(): void {
    for (const t of this.model.user) t.text = this.stateOf(t).doc.toString();
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY);
  }

  save(): void {
    clearTimeout(this.saveTimer);
    this.flush();
    this.model.save(this.o.prefs);
  }

  // ---- Diagnósticos ----

  private lint(tab: Tab, state: EditorState): Diagnostic[] {
    const k = kindOf(tab.name);
    if (k === "asm") {
      const errs = assemble(state.doc.toString(), { include: (p) => this.textOf(p) ?? clibResolve(p) }).errors;
      return toDiagnostics(state.doc, errs);
    }
    // C: se compila el programa al que pertenece la pestaña (ella si tiene main; si no, la principal).
    this.flush();
    const self = this.model.get(tab.id);
    if (!self) return [];
    self.text = state.doc.toString();
    const main = k === "c" && hasMain(self.text) ? self : this.model.main;
    if (!main || kindOf(main.name) !== "c") return [];
    const b = prepare(this.model, main);
    return toCm(state, b.diags.filter((d) => d.tab === tab.name), "compilador");
  }

  private textOf(name: string): string | undefined {
    const t = this.model.find(name.replace(/^.*[\\/]/, ""));
    return t && !t.ro ? this.stateOf(t).doc.toString() : undefined;
  }

  /** Muestra los diagnósticos de una construcción; las pestañas sin ninguno se limpian. */
  showDiags(diags: readonly TabDiag[]): void {
    for (const t of this.model.tabs) {
      const mine = diags.filter((d) => d.tab === t.name);
      const st = this.stateOf(t);
      this.updateTab(t, setDiagnostics(st, toCm(st, mine, t.name === GEN_NAME || kindOf(t.name) === "asm" ? "ensamblador" : "compilador")));
    }
  }

  // ---- Depuración ----

  bpLines(tab: Tab): number[] { return bpLinesOf(this.stateOf(tab)); }

  clearBps(): void {
    for (const t of this.model.tabs) if (this.bpLines(t).length) this.updateTab(t, { effects: bpLinesEffect([]) });
  }

  toggleBpAtCursor(): void { toggleBpAtCursor(this.view); }

  cursorLine(): number { return this.view.state.doc.lineAt(this.view.state.selection.main.head).number; }

  /** Línea actual del PC por pestaña (las que no salen, sin línea). Hace visible la de la activa. */
  setCurrentLines(lines: ReadonlyMap<number, number>): void {
    for (const t of this.model.tabs) {
      const l = lines.get(t.id) ?? null;
      if ((this.current.get(t.id) ?? null) === l) continue;
      this.current.set(t.id, l);
      const effects = [currentLineEffect(l)];
      const st = this.stateOf(t);
      const scroll = t.id === this.model.activeId && l !== null && l <= st.doc.lines
        ? [EditorView.scrollIntoView(st.doc.line(l).from, { y: "nearest" })] : [];
      this.updateTab(t, { effects: [...effects, ...scroll] });
    }
  }

  /** Olvida la línea actual recordada (tras construir, para repintarla seguro). */
  resetCurrent(): void { this.current.clear(); }

  // ---- Pestañas ----

  activate(id: number): void {
    const tab = this.model.get(id);
    if (!tab || id === this.model.activeId) return;
    const old = this.model.active;
    if (old) {
      this.states.set(old.id, this.view.state);
      this.scrolls.set(old.id, this.view.scrollDOM.scrollTop);
    }
    const st = this.takeStored(tab);
    this.model.setActive(id);
    this.view.setState(st);
    // Con línea actual del depurador se va a ella (puede haber cambiado estando oculta);
    // si no, a donde se dejó la pestaña.
    const cur = this.current.get(id) ?? null;
    if (cur !== null && cur <= st.doc.lines) {
      this.view.dispatch({ effects: EditorView.scrollIntoView(st.doc.line(cur).from, { y: "center" }) });
    } else {
      const top = this.scrolls.get(id) ?? 0;
      this.view.scrollDOM.scrollTop = top;
      requestAnimationFrame(() => { this.view.scrollDOM.scrollTop = top; });
    }
    this.renderBar();
    this.save();
    this.o.onSwitch?.(tab);
  }

  /** Nueva pestaña de usuario (nombre libre "nuevo.ext") y la pone en modo renombrar. */
  newTab(kind: TabKind): void {
    this.flush();
    const tab = this.model.add(this.model.freeName("nuevo", kind), "");
    this.activate(tab.id);
    this.startRename(tab.id);
  }

  /**
   * Abre un ejemplo. Si la pestaña activa es del mismo lenguaje y está vacía, se carga ahí;
   * si no, en una pestaña nueva con el nombre del ejemplo (no se pierde nada). Si ya hay
   * una pestaña con ese nombre y el mismo texto, sólo se activa.
   */
  openExample(id: string, kind: "asm" | "c", source: string): Tab {
    this.flush();
    const a = this.model.active;
    if (a && !a.ro && kindOf(a.name) === kind && a.text.trim() === "") {
      this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: source }, selection: { anchor: 0 }, scrollIntoView: true });
      this.save();
      return a;
    }
    const base = id.replace(/[^A-Za-z0-9_-]/g, "") || "ejemplo";
    for (let i = 1; ; i++) {
      const n = `${base}${i === 1 ? "" : i}.${kind}`;
      const t = this.model.find(n);
      if (t && t.text === source) { this.activate(t.id); return t; }
      if (!t) {
        const tab = this.model.add(n, source);
        this.activate(tab.id);
        return tab;
      }
    }
  }

  /** Abre (o reutiliza) la pestaña de sólo lectura de un fichero de la librería. */
  openLib(file: string): void {
    const text = CLIB_FILES.get(file);
    if (text === undefined) return;
    const tab = this.model.addReadOnly(libTabName(file), text, "lib");
    this.activate(tab.id);
  }

  /**
   * Pone el texto de la pestaña del ensamblador generado (la crea si no existe, sin
   * activarla). Conserva los breakpoints por número de línea.
   */
  setGenerated(asm: string): Tab {
    const old = this.model.find(GEN_NAME);
    const bps = old?.ro === "gen" ? this.bpLines(old) : [];
    const tab = this.model.addReadOnly(GEN_NAME, asm, "gen");
    let st = EditorState.create({ doc: asm, extensions: this.extensions(tab) });
    if (bps.length) st = st.update({ effects: bpLinesEffect(bps) }).state;
    this.current.delete(tab.id);
    if (tab.id === this.model.activeId) this.view.setState(st);
    else this.states.set(tab.id, st);
    this.renderBar();
    return tab;
  }

  /** Cierra con confirmación si la pestaña tiene contenido (las de sólo lectura no preguntan). */
  close(id: number): void {
    const tab = this.model.get(id);
    if (!tab) return;
    this.flush();
    if (!tab.ro && tab.text.trim() !== "" &&
        !confirm(`¿Cerrar «${tab.name}»? Se perderá su contenido (no se puede deshacer).`)) return;
    const wasActive = id === this.model.activeId;
    const lastUser = !tab.ro && this.model.user.length === 1;
    this.model.close(id);
    if (lastUser) {
      // La última pestaña de usuario no se quita: se vacía.
      this.updateTab(tab, { changes: { from: 0, to: this.stateOf(tab).doc.length, insert: "" } });
    } else {
      this.states.delete(id);
      this.scrolls.delete(id);
      this.current.delete(id);
      if (wasActive) {
        const next = this.model.active!;
        const st = this.takeStored(next);
        this.view.setState(st);
        this.o.onSwitch?.(next);
      }
    }
    this.renderBar();
    this.save();
    this.o.onBpsChanged();
  }

  move(id: number, to: number): void {
    this.model.move(id, to);
    this.renderBar();
    this.save();
  }

  rename(id: number, name: string): boolean {
    const tab = this.model.get(id);
    if (!tab) return false;
    const oldLang = langOf(tab);
    const err = this.model.rename(id, name);
    if (err) { this.o.say(err); this.renderBar(); return false; }
    if (langOf(tab) !== oldLang) {
      // Otro lenguaje: el resaltado va en el estado, así que se rehace con el mismo texto,
      // selección y breakpoints (se pierde el historial de deshacer de esa pestaña).
      const st = this.stateOf(tab);
      const bps = bpLinesOf(st);
      let next = EditorState.create({ doc: st.doc, selection: st.selection, extensions: this.extensions(tab) });
      if (bps.length) next = next.update({ effects: bpLinesEffect(bps) }).state;
      if (tab.id === this.model.activeId) this.view.setState(next);
      else this.states.set(tab.id, next);
    }
    this.renderBar();
    this.save();
    this.o.onBpsChanged();
    return true;
  }

  // ---- Barra ----

  renderBar(): void {
    const bar = this.o.bar;
    const m = this.model;
    bar.replaceChildren();
    bar.setAttribute("role", "tablist");
    for (const t of m.tabs) {
      const el = document.createElement("div");
      el.className = "tab" + (t.ro ? ` tab-ro tab-${t.ro}` : "");
      el.dataset.id = String(t.id);
      el.setAttribute("role", "tab");
      el.setAttribute("aria-selected", String(t.id === m.activeId));
      el.tabIndex = t.id === m.activeId ? 0 : -1;
      el.draggable = true;
      el.title = t.ro === "gen" ? "Ensamblador generado por el compilador de C (sólo lectura; se rehace al compilar)"
        : t.ro === "lib" ? "Fichero de la librería de C (sólo lectura)"
        : `${t.name}${t.id === m.mainId ? " — principal: Ctrl+Enter la ejecuta cuando la pestaña activa no es un programa" : ""}. Doble clic para renombrar; arrastra para reordenar.`;
      if (t.id === m.mainId) {
        const s = document.createElement("span");
        s.className = "tab-main";
        s.textContent = "▶";
        s.setAttribute("aria-label", "principal");
        el.append(s);
      }
      const name = document.createElement("span");
      name.className = "tab-name";
      name.textContent = t.name;
      el.append(name);
      const x = document.createElement("button");
      x.type = "button";
      x.className = "tab-x";
      x.textContent = "×";
      x.title = `Cerrar ${t.name}`;
      x.tabIndex = -1;
      el.append(x);
      bar.append(el);
    }
    if (!bar.dataset.wired) this.wireBar(bar);
  }

  private tabEl(e: Event): HTMLElement | null {
    return (e.target as HTMLElement).closest<HTMLElement>(".tab");
  }

  private wireBar(bar: HTMLElement): void {
    bar.dataset.wired = "1";
    const idOf = (el: HTMLElement) => Number(el.dataset.id);
    bar.addEventListener("click", (e) => {
      const el = this.tabEl(e);
      if (!el) return;
      if ((e.target as HTMLElement).closest(".tab-x")) { this.close(idOf(el)); return; }
      if ((e.target as HTMLElement).closest("input")) return;
      this.activate(idOf(el));
    });
    bar.addEventListener("auxclick", (e) => {
      const el = this.tabEl(e);
      if (el && e.button === 1) { e.preventDefault(); this.close(idOf(el)); }
    });
    bar.addEventListener("dblclick", (e) => {
      const el = this.tabEl(e);
      if (el && !(e.target as HTMLElement).closest(".tab-x")) this.startRename(idOf(el));
    });
    bar.addEventListener("keydown", (e) => {
      const el = this.tabEl(e);
      if (!el || (e.target as HTMLElement).closest("input")) return;
      const id = idOf(el);
      const i = this.model.indexOf(id);
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const d = e.key === "ArrowLeft" ? -1 : 1;
        e.preventDefault();
        if (e.altKey && e.shiftKey) { this.move(id, i + d); this.focusTab(id); return; }
        const t = this.model.tabs[(i + d + this.model.tabs.length) % this.model.tabs.length]!;
        this.activate(t.id);
        this.focusTab(t.id);
      } else if (e.key === "F2") { e.preventDefault(); this.startRename(id); }
      else if (e.key === "Delete") { e.preventDefault(); this.close(id); }
      else if (e.key === "Enter") { e.preventDefault(); this.view.focus(); }
    });
    bar.addEventListener("dragstart", (e) => {
      const el = this.tabEl(e);
      if (!el || !e.dataTransfer) return;
      this.dragId = idOf(el);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", el.dataset.id!);
      el.classList.add("dragging");
    });
    bar.addEventListener("dragover", (e) => {
      if (this.dragId === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    bar.addEventListener("drop", (e) => {
      if (this.dragId === null) return;
      e.preventDefault();
      const el = this.tabEl(e);
      const id = this.dragId;
      this.dragId = null;
      if (!el) { this.move(id, this.model.tabs.length); return; }
      const r = el.getBoundingClientRect();
      let to = this.model.indexOf(idOf(el)) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
      if (this.model.indexOf(id) < to) to--;
      this.move(id, to);
    });
    bar.addEventListener("dragend", () => { this.dragId = null; this.renderBar(); });
  }

  private focusTab(id: number): void {
    this.o.bar.querySelector<HTMLElement>(`.tab[data-id="${id}"]`)?.focus();
  }

  /** Cambia el nombre de la pestaña por un campo de texto (Enter acepta, Escape cancela). */
  startRename(id: number): void {
    const tab = this.model.get(id);
    if (!tab || tab.ro) return;
    const el = this.o.bar.querySelector<HTMLElement>(`.tab[data-id="${id}"] .tab-name`);
    if (!el) return;
    const input = document.createElement("input");
    input.className = "tab-rename";
    input.value = tab.name;
    input.size = Math.max(8, tab.name.length + 2);
    input.setAttribute("aria-label", "Nombre de la pestaña");
    el.replaceWith(input);
    input.focus();
    const dot = tab.name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : tab.name.length);
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (ok && input.value !== tab.name) { this.rename(id, input.value.trim()); }
      else this.renderBar();
      this.view.focus();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    input.addEventListener("blur", () => finish(true));
  }
}
