// Editor CodeMirror 6 del IDE: resaltado Z80, diagnósticos del ensamblador (en vivo y
// al ejecutar), guardado automático en localStorage y Ctrl+Enter para ejecutar.
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, highlightSpecialChars,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, insertTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter, lintKeymap, setDiagnostics } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";
import { assemble, type AsmError } from "../../asm";
import { loadPref, savePref } from "../layout";
import { toDiagnostics } from "./diagnostics";
import { DEFAULT_EXAMPLE, EXAMPLES } from "./examples";
import { z80Language } from "./z80lang";

export const SOURCE_KEY = "zx.editor.source";
const SAVE_DELAY = 400;
const LINT_DELAY = 500;

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "#e6d23a", fontWeight: "600" },
  { tag: t.meta, color: "#c792ea" },
  { tag: t.typeName, color: "#3fb8e6" },
  { tag: t.atom, color: "#f78c6c" },
  { tag: t.number, color: "#f78c6c" },
  { tag: t.string, color: "#6fd28a" },
  { tag: t.comment, color: "#7f8592", fontStyle: "italic" },
  { tag: t.labelName, color: "#ffffff", fontWeight: "600" },
  { tag: t.macroName, color: "#ffcb6b" },
  { tag: [t.operator, t.operatorKeyword], color: "#89ddff" },
  { tag: t.invalid, color: "#ff6b5e", textDecoration: "underline wavy" },
]);

const theme = EditorView.theme({
  "&": { flex: "1", minWidth: "0", height: "100%", backgroundColor: "transparent", color: "var(--text)" },
  ".cm-scroller": { fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace', fontSize: "14px", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-gutters": { backgroundColor: "var(--panel)", color: "var(--muted)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.04)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgba(63,184,230,0.25)" },
  ".cm-tooltip": { backgroundColor: "var(--panel-2)", border: "1px solid var(--line)" },
}, { dark: true });

export interface EditorHandle {
  view: EditorView;
  source(): string;
  /** Sustituye todo el texto (deshacible con Ctrl+Z). */
  setSource(text: string): void;
  showErrors(errors: readonly AsmError[]): void;
}

export interface EditorOptions {
  /** Ctrl+Enter / Cmd+Enter. */
  onRun(): void;
}

/** Monta el editor dentro de `host` (lo vacía antes). */
export function mountEditor(host: HTMLElement, opts: EditorOptions): EditorHandle {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    EditorState.tabSize.of(8),
    z80Language,
    syntaxHighlighting(highlight),
    theme,
    lintGutter(),
    linter((view) => toDiagnostics(view.state.doc, assemble(view.state.doc.toString()).errors), { delay: LINT_DELAY }),
    keymap.of([
      { key: "Mod-Enter", run: () => { opts.onRun(); return true; }, preventDefault: true },
      { key: "Tab", run: insertTab },
      ...defaultKeymap, ...historyKeymap, ...lintKeymap,
    ]),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => savePref(SOURCE_KEY, u.state.doc.toString()), SAVE_DELAY);
    }),
    EditorView.contentAttributes.of({ "aria-label": "Código fuente Z80", spellcheck: "false", autocapitalize: "off" }),
  ];
  host.replaceChildren();
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc: loadPref(SOURCE_KEY) ?? DEFAULT_EXAMPLE.source, extensions }),
  });
  return {
    view,
    source: () => view.state.doc.toString(),
    setSource(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 }, scrollIntoView: true });
    },
    showErrors(errors) {
      view.dispatch(setDiagnostics(view.state, toDiagnostics(view.state.doc, errors)));
    },
  };
}

/** Rellena un <select> con los ejemplos; al elegir uno, lo carga en el editor. */
export function attachExamples(select: HTMLSelectElement, editor: EditorHandle, onLoaded?: (title: string) => void): void {
  select.replaceChildren(new Option("Ejemplos…", ""));
  for (const ex of EXAMPLES) select.append(new Option(ex.title, ex.id));
  select.onchange = () => {
    const ex = EXAMPLES.find((e) => e.id === select.value);
    select.value = "";
    if (!ex) return;
    editor.setSource(ex.source);
    editor.view.focus();
    onLoaded?.(ex.title);
  };
}
