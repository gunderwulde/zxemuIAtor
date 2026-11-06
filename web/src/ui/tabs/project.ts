// Proyecto: de un manifiesto .tape y las pestañas a una cinta. Puro (sin DOM).
//
// Cada bloque code/data nombra una pestaña fuente (.asm o .c): se ensambla una sola vez por
// fuente (con INCLUDE/INCBIN de las demás pestañas, recursos incluidos) y de su imagen de
// memoria se toman los bytes de `addr`. Así un juego puede tener varios programas que se
// cargan en las mismas direcciones (los niveles de Sootland) sin chocar entre sí.
import { assemble, type AsmResult } from "../../asm";
import { tokenizeBasic } from "../../export/basic";
import { header, tapBlock, TYPE_CODE, TYPE_PROGRAM } from "../../export/tap";
import { parseTapeDoc, type TapeDoc } from "../../res/tape";
import type { RunMessage } from "../run";
import { finish, prepare, type TabDiag } from "./build";
import { isTape, kindOf, tapeSources, type Tab, type TabsModel } from "./model";

export { isTape, tapeSources };

export interface ProjectBlockInfo { index: number; desc: string; flag: number; len: number }

export interface ProjectBuild {
  ok: boolean;
  /** null si hubo errores. */
  tap: Uint8Array<ArrayBuffer> | null;
  messages: RunMessage[];
  diags: TabDiag[];
  blocks: ProjectBlockInfo[];
  /** Ensamblados por pestaña fuente (para símbolos y depuración). */
  asm: Map<string, AsmResult>;
  doc: TapeDoc | null;
}

const h4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

/** Bytes de la imagen del ensamblado desde `addr`: `len` o el tramo contiguo; null y motivo si faltan. */
function imageBytes(asm: AsmResult, addr: number, len: number | undefined): { bytes: number[] } | { error: string } {
  const mem = new Map<number, number>();
  for (const s of asm.segments) s.bytes.forEach((b, i) => mem.set((s.addr + i) & 0xffff, b));
  const out: number[] = [];
  for (let a = addr; len === undefined ? mem.has(a & 0xffff) : out.length < len; a++) {
    if (a > 0xffff) return { error: `${h4(addr)}h + ${out.length} se sale de la memoria` };
    const b = mem.get(a);
    if (b === undefined) return { error: `no hay bytes ensamblados en ${h4(a)}h (se pedían ${len ?? "los contiguos"} desde ${h4(addr)}h)` };
    out.push(b);
  }
  if (out.length === 0) return { error: `no hay bytes ensamblados en ${h4(addr)}h` };
  return { bytes: out };
}

export function buildProject(model: TabsModel, tape: Tab): ProjectBuild {
  const messages: RunMessage[] = [];
  const diags: TabDiag[] = [];
  const res: ProjectBuild = { ok: false, tap: null, messages, diags, blocks: [], asm: new Map(), doc: null };
  const fail = (text: string) => { messages.push({ severity: "error", text: `${tape.name}: ${text}` }); return res; };

  let doc: TapeDoc;
  try { doc = parseTapeDoc(tape.text); } catch (e) { return fail((e as Error).message); }
  res.doc = doc;

  // Ensamblado de cada fuente, una vez.
  let failed = false;
  for (const src of tapeSources(tape.text)) {
    if (res.asm.has(src)) continue;
    const t = model.find(src);
    if (!t || t.ro || (kindOf(t.name) !== "asm" && kindOf(t.name) !== "c")) {
      failed = true;
      messages.push({ severity: "error", text: `${tape.name}: no hay una pestaña .asm o .c llamada «${src}».` });
      continue;
    }
    const b = prepare(model, t);
    diags.push(...b.diags);
    messages.push(...b.messages);
    if (!b.ok) { failed = true; continue; }
    const asm = assemble(b.source, b.asmOpts);
    const fin = finish(model, b, asm);
    diags.push(...fin.diags);
    for (const d of fin.diags) if (!b.diags.includes(d)) messages.push({ severity: d.severity, text: `${d.tab}:${d.line}:${d.col}: ${d.severity === "error" ? "error" : "aviso"}: ${d.msg}` });
    messages.push(...fin.messages);
    res.asm.set(src, asm);
    if (asm.errors.some((e) => e.severity === "error")) failed = true;
  }
  if (failed) { messages.push({ severity: "error", text: "Hay errores: no se construye la cinta." }); return res; }

  const tap: number[] = [];
  let bytesTotal = 0;
  doc.blocks.forEach((b, i) => {
    const n = i + 1;
    if (b.type === "basic") {
      const r = tokenizeBasic(b.source);
      if (r.errors.length) { for (const e of r.errors) messages.push({ severity: "error", text: `${tape.name}: bloque ${n} (BASIC), línea ${e.line}: ${e.msg}` }); failed = true; return; }
      const auto = b.autostart ?? 0x8000;
      tap.push(...tapBlock(0x00, header(TYPE_PROGRAM, b.name, r.bytes.length, auto, r.bytes.length)));
      tap.push(...tapBlock(0xff, r.bytes));
      res.blocks.push({ index: n, desc: `BASIC «${b.name}»`, flag: 0xff, len: r.bytes.length });
      bytesTotal += r.bytes.length;
      return;
    }
    const img = imageBytes(res.asm.get(b.src)!, b.addr, b.len);
    if ("error" in img) { messages.push({ severity: "error", text: `${tape.name}: bloque ${n} (${b.src}): ${img.error}` }); failed = true; return; }
    if (b.type === "code") {
      tap.push(...tapBlock(0x00, header(TYPE_CODE, b.name, img.bytes.length, b.addr, b.param2 ?? 0x8000)));
      tap.push(...tapBlock(0xff, img.bytes));
      res.blocks.push({ index: n, desc: `CODE «${b.name}» en ${h4(b.addr)}h`, flag: 0xff, len: img.bytes.length });
    } else {
      tap.push(...tapBlock(b.flag, img.bytes));
      res.blocks.push({ index: n, desc: `datos sin cabecera de ${b.src} desde ${h4(b.addr)}h`, flag: b.flag, len: img.bytes.length });
    }
    bytesTotal += img.bytes.length;
  });
  if (failed) return res;

  res.tap = Uint8Array.from(tap);
  res.ok = true;
  messages.push({
    severity: "info",
    text: `Cinta «${doc.name || tape.name}»: ${doc.blocks.length} bloque${doc.blocks.length === 1 ? "" : "s"}, ${bytesTotal} bytes de datos. Cárgala con LOAD "".`,
  });
  return res;
}
