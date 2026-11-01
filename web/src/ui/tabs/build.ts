// U1: de pestañas a programa. Puro (sin DOM): lo usan la UI y los tests contra el núcleo.
//
//  .asm → assemble(texto, include = pestañas de usuario y librería)
//  .c   → compile(.c principal + .h + .c sin main, includeResolver = librería)
//         → texto ensamblador (pestaña "(generado).asm") → assemble
//
// Después se inyecta con assembleAndRun (I1) o se exporta con exportSourceTap (E1), los
// dos sobre el mismo texto `source`; finish() traduce los errores a (pestaña, línea) y
// construye el mapa de depuración.
import type { AsmError, AsmOptions, AsmResult } from "../../asm";
import { compile, type CcError, type CcResult } from "../../cc";
import { CLIB_FILES, clibResolve } from "../../clib";
import { exportSourceTap, type SourceTapExport } from "../../export";
import { assembleAndRun, type RunCore, type RunMessage, type RunReport } from "../run";
import { GEN_NAME, kindOf, libTabName, type Tab, type TabsModel } from "./model";
import { SourceMap, asmLineOwners } from "./srcmap";

export interface TabDiag {
  /** Pestaña (nombre de usuario, GEN_NAME o "<lib.h>"). */
  tab: string;
  line: number;
  /** 1-based. */
  col: number;
  msg: string;
  severity: "error" | "warning";
}

export interface Build {
  target: Tab;
  kind: "asm" | "c";
  /** Texto que se ensambla: el de la pestaña o el generado por el compilador. */
  source: string;
  asmOpts: AsmOptions;
  /** Nombre del fuente ensamblado en los mensajes. */
  label: string;
  cc?: CcResult;
  /** El compilador no ha dado errores (en .asm, siempre). */
  ok: boolean;
  messages: RunMessage[];
  diags: TabDiag[];
}

/** Nombre de pestaña de un fichero que nombra el compilador o el ensamblador. */
function tabOf(model: TabsModel, file: string): string {
  const base = file.replace(/^.*[\\/]/, "");
  const t = model.find(base);
  if (t && !t.ro) return t.name;
  return CLIB_FILES.has(base) ? libTabName(base) : base;
}

const fmt = (file: string, line: number, col: number, sev: "error" | "warning", msg: string) =>
  `${file}:${line}:${col}: ${sev === "error" ? "error" : "aviso"}: ${msg}`;

export function prepare(model: TabsModel, target: Tab): Build {
  if (kindOf(target.name) === "asm") {
    return {
      target, kind: "asm", source: target.text, label: target.name, ok: true, messages: [], diags: [],
      asmOpts: { include: (path) => model.userText(path) ?? clibResolve(path) },
    };
  }
  const cc = compile(model.cFiles(target), { main: target.name, includeResolver: (n) => clibResolve(n) });
  const diags: TabDiag[] = cc.errors.map((e: CcError) => ({ tab: tabOf(model, e.file), line: e.line, col: e.col, msg: e.msg, severity: e.severity }));
  const messages: RunMessage[] = diags.map((d) => ({ severity: d.severity, text: fmt(d.tab, d.line, d.col, d.severity, d.msg) }));
  const nErr = cc.errors.filter((e) => e.severity === "error").length;
  if (nErr) messages.push({ severity: "error", text: `${nErr} error${nErr === 1 ? "" : "es"} de compilación: no se ejecuta nada.` });
  else messages.push({ severity: "info", text: `Compilado ${target.name}: ${cc.emitted.length} función${cc.emitted.length === 1 ? "" : "es"}; el ensamblador está en «${GEN_NAME}».` });
  return { target, kind: "c", source: cc.asm, label: GEN_NAME, asmOpts: {}, cc, ok: nErr === 0, messages, diags };
}

export interface Finished {
  srcMap: SourceMap;
  /** Diagnósticos del compilador y del ensamblador, por pestaña. */
  diags: TabDiag[];
  /** Mensajes extra: de qué línea C viene cada error del ensamblado generado. */
  messages: RunMessage[];
}

/** Errores del ensamblador → pestañas, y mapa de depuración del programa ensamblado. */
export function finish(model: TabsModel, b: Build, asm: AsmResult): Finished {
  const diags = [...b.diags];
  const messages: RunMessage[] = [];
  if (b.kind === "asm") {
    for (const e of asm.errors) diags.push(asmDiag(e, e.file === undefined ? b.target.name : tabOf(model, e.file)));
    return { srcMap: SourceMap.fromAsm(asm.lineMap, b.target.name, (f) => tabOf(model, f)), diags, messages };
  }
  const cc = b.cc!;
  const owners = asmLineOwners(b.source, cc.cLineMap);
  for (const e of asm.errors) {
    diags.push(asmDiag(e, GEN_NAME));
    const k = e.file === undefined ? owners[e.line] ?? -1 : -1;
    if (k < 0) continue;
    const c = cc.cLineMap[k]!;
    const tab = tabOf(model, c.file);
    const msg = `ensamblador (${GEN_NAME}:${e.line}): ${e.msg}`;
    diags.push({ tab, line: c.line, col: 1, msg, severity: e.severity });
    messages.push({ severity: e.severity, text: `${tab}:${c.line}: aquí se generó la línea ${e.line} con el ${e.severity === "error" ? "error" : "aviso"} del ensamblador.` });
  }
  return { srcMap: SourceMap.fromC(b.source, cc.cLineMap, asm.lineMap, GEN_NAME), diags, messages };
}

function asmDiag(e: AsmError, tab: string): TabDiag {
  return { tab, line: e.line, col: e.col, msg: e.msg, severity: e.severity };
}

export interface RunResult {
  build: Build;
  /** null si no compiló (no se llegó a ensamblar). */
  report: RunReport | null;
  fin: Finished | null;
  ok: boolean;
  messages: RunMessage[];
  diags: TabDiag[];
}

/** Construye `target` y lo inyecta en la máquina (assembleAndRun de I1). */
export function buildAndRun(core: RunCore, model: TabsModel, target: Tab): RunResult {
  const build = prepare(model, target);
  if (!build.ok) return { build, report: null, fin: null, ok: false, messages: build.messages, diags: build.diags };
  const report = assembleAndRun(core, build.source, build.asmOpts, build.label);
  const fin = finish(model, build, report.asm);
  return {
    build, report, fin, ok: report.ok,
    messages: [...build.messages, ...report.messages, ...fin.messages],
    diags: fin.diags,
  };
}

export interface ExportResult {
  build: Build;
  exp: SourceTapExport | null;
  diags: TabDiag[];
  messages: RunMessage[];
}

/** Construye `target` y genera el .tap (exportSourceTap de E1). */
export function buildTapFor(model: TabsModel, target: Tab): ExportResult {
  const build = prepare(model, target);
  if (!build.ok) return { build, exp: null, diags: build.diags, messages: build.messages };
  const name = target.name.replace(/\.[^.]*$/, "") || "programa";
  const exp = exportSourceTap(build.source, name, build.asmOpts, build.label);
  const fin = finish(model, build, exp.asm);
  return { build, exp, diags: fin.diags, messages: [...build.messages, ...exp.messages, ...fin.messages] };
}
