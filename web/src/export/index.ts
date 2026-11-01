// E1: de fuente a .tap (ensamblar + buildTap). Puro (sin DOM).
import { assemble, type AsmOptions, type AsmResult } from "../asm";
import { buildTap, type ExportMessage } from "./tap";

export { buildTap, type ExportMessage, type TapExport } from "./tap";
export { downloadBytes, stampedName } from "./download";

export interface SourceTapExport { asm: AsmResult; tap: Uint8Array<ArrayBuffer> | null; messages: ExportMessage[] }

/**
 * Ensambla `source` y, si no hay errores, genera el .tap con cargador. `label`: nombre
 * del fuente en los mensajes de error (U1: la pestaña, o "(generado).asm" si es C).
 */
export function exportSourceTap(source: string, name: string, opts: AsmOptions = {}, label?: string): SourceTapExport {
  const asm = assemble(source, opts);
  const messages: ExportMessage[] = asm.errors.map((e) => ({
    severity: e.severity,
    text: `${(e.file ?? label) ? (e.file ?? label) + ":" : ""}${e.line}:${e.col}: ${e.severity === "error" ? "error" : "aviso"}: ${e.msg}`,
  }));
  if (asm.errors.some((e) => e.severity === "error")) {
    messages.push({ severity: "error", text: "Hay errores de ensamblado: no se exporta." });
    return { asm, tap: null, messages };
  }
  const r = buildTap(asm.segments, asm.entry, name);
  return { asm, tap: r.tap, messages: [...messages, ...r.messages] };
}
