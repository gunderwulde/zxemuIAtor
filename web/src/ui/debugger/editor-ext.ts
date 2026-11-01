// D1: extensiones de CodeMirror para el depurador, instaladas sobre el EditorView del
// editor de I1 con StateEffect.appendConfig (sin tocar ui/editor/index.ts):
//  - margen de breakpoints por línea (clic o F9); los marcadores siguen a su línea
//    cuando se edita el texto (RangeSet.map);
//  - línea actual (PC dentro del programa ensamblado) resaltada.
import { RangeSet, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, GutterMarker, gutter } from "@codemirror/view";

class BpMarker extends GutterMarker {
  override toDOM(): Node {
    const s = document.createElement("span");
    s.className = "dbg-bp-dot";
    s.textContent = "●";
    return s;
  }
}
const BP = new BpMarker();

const toggleBpAt = StateEffect.define<number>(); // posición de inicio de línea
const setBpLines = StateEffect.define<number[]>();
const setCurrent = StateEffect.define<number | null>(); // línea 1-based

const bpField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(toggleBpAt)) {
        let has = false;
        set.between(e.value, e.value, () => { has = true; });
        set = has
          ? set.update({ filter: (from) => from !== e.value })
          : set.update({ add: [BP.range(e.value)] });
      } else if (e.is(setBpLines)) {
        const doc = tr.state.doc;
        const ranges: Range<GutterMarker>[] = e.value
          .filter((l) => l >= 1 && l <= doc.lines)
          .sort((a, b) => a - b)
          .map((l) => BP.range(doc.line(l).from));
        set = RangeSet.of(ranges);
      }
    }
    return set;
  },
});

const currentDeco = Decoration.line({ class: "dbg-cur-line" });
const currentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setCurrent)) continue;
      const l = e.value;
      deco = l !== null && l >= 1 && l <= tr.state.doc.lines
        ? Decoration.set([currentDeco.range(tr.state.doc.line(l).from)])
        : Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface EditorDebugHandle {
  /** Líneas (1-based) con breakpoint, ordenadas y sin repetir. */
  bpLines(): number[];
  setBpLines(lines: number[]): void;
  toggleAtCursor(): void;
  /** Línea actual del PC, o null para quitarla. `scroll` la hace visible. */
  setCurrentLine(line: number | null, scroll: boolean): void;
  cursorLine(): number;
}

export function attachEditorDebug(view: EditorView, onBpsChanged: (lines: number[]) => void): EditorDebugHandle {
  const lines = (): number[] => {
    const out = new Set<number>();
    const doc = view.state.doc;
    view.state.field(bpField).between(0, doc.length, (from) => { out.add(doc.lineAt(from).number); });
    return [...out].sort((a, b) => a - b);
  };
  let last = "";
  const notify = () => {
    const l = lines();
    const k = l.join(",");
    if (k !== last) { last = k; onBpsChanged(l); }
  };
  const toggleLine = (from: number) => view.dispatch({ effects: toggleBpAt.of(from) });

  view.dispatch({
    effects: StateEffect.appendConfig.of([
      bpField,
      currentField,
      gutter({
        class: "dbg-bp-gutter",
        markers: (v) => v.state.field(bpField),
        initialSpacer: () => BP,
        domEventHandlers: {
          mousedown(_v, line) { toggleLine(line.from); return true; },
        },
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(toggleBpAt) || e.is(setBpLines)))) notify();
      }),
    ]),
  });

  return {
    bpLines: lines,
    setBpLines: (l) => view.dispatch({ effects: setBpLines.of(l) }),
    toggleAtCursor: () => toggleLine(view.state.doc.lineAt(view.state.selection.main.head).from),
    setCurrentLine(line, scroll) {
      const effects: StateEffect<unknown>[] = [setCurrent.of(line)];
      if (scroll && line !== null && line <= view.state.doc.lines) {
        effects.push(EditorView.scrollIntoView(view.state.doc.line(line).from, { y: "nearest" }));
      }
      view.dispatch({ effects });
    },
    cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
  };
}
