// Errores del ensamblador → diagnósticos de CodeMirror y resumen de texto. Puro (sin DOM).
import type { Text } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import type { AsmError } from "../../asm";

/**
 * line/col del ensamblador son 1-based. El diagnóstico cubre el token que empieza en esa
 * columna (hasta espacio, coma, paréntesis o ';'); si no hay token, la línea entera.
 * Los errores de ficheros incluidos (file) se ponen en la línea 1: el editor no los muestra.
 */
export function toDiagnostics(doc: Text, errors: readonly AsmError[]): Diagnostic[] {
  return errors.map((e) => {
    const lineNo = e.file ? 1 : Math.min(Math.max(e.line, 1), doc.lines);
    const line = doc.line(lineNo);
    const col = e.file ? 0 : Math.min(Math.max(e.col - 1, 0), line.length);
    let from = line.from + col;
    const tok = /^[^\s,;()]+/.exec(line.text.slice(col));
    let to = tok ? from + tok[0].length : line.to;
    if (from === to) from = line.from;
    if (from === to && to < doc.length) to++;
    return {
      from, to,
      severity: e.severity,
      message: e.file ? `${e.file}:${e.line}:${e.col}: ${e.msg}` : e.msg,
      source: "ensamblador",
    };
  });
}

/** "2 errores, 1 aviso" o "" si no hay nada. */
export function summary(errors: readonly AsmError[]): string {
  const ne = errors.filter((e) => e.severity === "error").length;
  const nw = errors.length - ne;
  const parts: string[] = [];
  if (ne) parts.push(`${ne} error${ne === 1 ? "" : "es"}`);
  if (nw) parts.push(`${nw} aviso${nw === 1 ? "" : "s"}`);
  return parts.join(", ");
}
