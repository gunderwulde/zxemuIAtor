// Peephole (K1): reglas locales sobre el texto generado por codegen.ts. Solo mira las
// instrucciones que emite el propio compilador; los bloques __asm del usuario van entre
// ASM_BEGIN y ASM_END y son una barrera (ni se tocan ni se cruzan).
//
// Cada regla tiene su caso en tests/cc/peephole.test.ts y su efecto medido en bytes en
// tests/cc/size.test.ts.

import { MARK } from "./codegen";

import { ASM_BEGIN, ASM_END } from "./codegen";
export { ASM_BEGIN, ASM_END };

const INSN = "        ";
const isInsn = (s: string) => s.startsWith(INSN) && s.length > 8 && s[8] !== ";";
const isLabel = (s: string) => /^[A-Za-z_.][\w.]*:$/.test(s);
const body = (s: string) => s.slice(8);

const INV: Record<string, string> = { z: "nz", nz: "z", c: "nc", nc: "c", p: "m", m: "p", pe: "po", po: "pe" };

/** Aplica las reglas hasta punto fijo. Devuelve el número de reglas aplicadas. */
export function peephole(lines: string[]): number {
  let total = 0;
  for (let pass = 0; pass < 8; pass++) {
    const n = onePass(lines);
    total += n;
    if (n === 0) break;
  }
  return total;
}

function onePass(L: string[]): number {
  let hits = 0;
  let inAsm = false;
  // Índices de instrucciones del compilador, con barreras (etiquetas, asm) como null.
  const seq: (number | null)[] = [];
  for (let i = 0; i < L.length; i++) {
    const s = L[i]!;
    if (s === ASM_BEGIN) { inAsm = true; seq.push(-1); continue; }
    if (s === ASM_END) { inAsm = false; seq.push(-1); continue; }
    if (inAsm) continue;
    if (isInsn(s)) seq.push(i);
    else if (isLabel(s)) seq.push(null, i, null);
  }
  const del = new Set<number>();
  const get = (k: number) => { const i = seq[k]; return i === null || i === undefined || i < 0 || del.has(i) ? null : i; };
  for (let k = 0; k < seq.length; k++) {
    const i = get(k);
    if (i === null) continue;
    const a = body(L[i]!);
    if (isLabel(L[i]!)) continue;
    const j = get(k + 1);
    const b = j !== null && !isLabel(L[j]!) ? body(L[j]!) : null;

    // push hl / pop hl
    if (a === "push hl" && b === "pop hl") { del.add(i); del.add(j!); hits++; continue; }
    // push hl / pop de  ->  ld d,h / ld e,l   (21 T -> 8 T)
    if (a === "push hl" && b === "pop de") { L[i] = INSN + "ld d,h"; L[j!] = INSN + "ld e,l"; hits++; continue; }
    if (a === "ex de,hl" && b === "ex de,hl") { del.add(i); del.add(j!); hits++; continue; }
    // ld (X),hl / ld hl,(X)
    if (b !== null) {
      const m = /^ld \((.+)\),hl$/.exec(a);
      if (m && b === `ld hl,(${m[1]})`) { del.add(j!); hits++; continue; }
      // ld (ix+o),l / ld l,(ix+o)
      const m2 = /^ld (\(ix[+-]\d+\)),([lh])$/.exec(a);
      if (m2 && b === `ld ${m2[2]},${m2[1]}`) { del.add(j!); hits++; continue; }
      // ld (ix+o),l / ld (ix+o+1),h / ld l,(ix+o) / ld h,(ix+o+1)
      const m3 = /^ld (\(ix[+-]\d+\)),l$/.exec(a);
      const n3 = /^ld (\(ix[+-]\d+\)),h$/.exec(b);
      const k2 = get(k + 2), k3 = get(k + 3);
      if (m3 && n3 && k2 !== null && k3 !== null && body(L[k2]!) === `ld l,${m3[1]}` && body(L[k3]!) === `ld h,${n3[1]}`) {
        del.add(k2); del.add(k3); hits++; continue;
      }
      // ld a,l / ld (X),a / ld a,(X)  -> la segunda carga sobra
      if (a === "ld a,l" && k2 !== null && /^ld \((.+)\),a$/.test(b) && body(L[k2]!) === b.replace(/^ld \((.+)\),a$/, "ld a,($1)")) {
        del.add(k2); hits++; continue;
      }
    }
    // jp cc,L1 / jp L2 / L1:   ->  jp !cc,L2 / L1:
    const jc = /^jp (n?z|n?c|p|m|p[eo]),(\S+)$/.exec(a);
    if (jc && b !== null && /^jp \S+$/.test(b) && !b.includes("(")) {
      const nextLabels = labelsAfter(L, seq, k + 2, del);
      if (nextLabels.has(jc[2]!)) {
        L[i] = INSN + `jp ${INV[jc[1]!]},${b.slice(3)}`;
        del.add(j!);
        hits++;
        continue;
      }
    }
    // jp L / L:
    const jm = /^jp ([^(,\s]+)$/.exec(a);
    if (jm && labelsAfter(L, seq, k + 1, del).has(jm[1]!)) { del.add(i); hits++; continue; }
    // Código muerto tras salto incondicional o ret, hasta la siguiente etiqueta.
    if (jm || a === "ret" || a === "jp (hl)") {
      let q = k + 1;
      for (; q < seq.length; q++) {
        const x = seq[q];
        if (x === null || x === undefined || x < 0) break;
        if (del.has(x)) continue;
        del.add(x);
        hits++;
      }
    }
  }
  if (del.size) {
    const keep = L.filter((_, i) => !del.has(i));
    L.length = 0;
    L.push(...keep);
  }
  return hits;
}

/** Etiquetas que siguen inmediatamente (sin instrucciones entre medias) a la posición k. */
function labelsAfter(L: string[], seq: (number | null)[], k: number, del: Set<number>): Set<string> {
  const out = new Set<string>();
  for (let q = k; q < seq.length; q++) {
    const x = seq[q];
    if (x === null || x === undefined) continue;
    if (x < 0) break;
    if (del.has(x)) continue;
    if (isLabel(L[x]!)) { out.add(L[x]!.slice(0, -1)); continue; }
    break;
  }
  return out;
}

export { MARK };
