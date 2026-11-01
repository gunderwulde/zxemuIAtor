// CPU-02 · SingleStepTests/z80 (EXT) sobre core-test.wasm (docs/TEST-PLAN.md §2).
//
// Fixture: tests/fixtures/singlestep/v1/*.json (npm run fetch:singlestep). Cada fichero
// tiene 1000 casos de una instrucción. Modo fast: 25 casos por fichero (sólo se leen
// los primeros KB de cada JSON). Modo full: ZX_FULL=1, los 1000.
//
// QUÉ SE COMPARA (todo sale del JSON):
//  - Registros finales: a f b c d e h l, af_ bc_ de_ hl_, ix iy sp pc, i r,
//    wz (= memptr), iff1 iff2 im, q (= q), ei (= ei_delay), p (= ld_air).
//  - RAM final: cada par [addr, valor] de final.ram.
//  - Puertos: las lecturas se alimentan con tb_port_queue en el orden de "ports"
//    (tipo "r"); se compara la secuencia de accesos de E/S completa (dirección, valor,
//    lectura/escritura) con "ports".
//  - Ciclos: el total (cycles.length = T-states) frente a tb_tstates(), y la secuencia
//    de accesos de memoria y E/S con su T:
//      · en el JSON cada entrada es un T; un acceso de memoria es la entrada con "r-m-"
//        o "-wm-", uno de E/S la de "r--i" o "-w-i". El dato de una lectura aparece en
//        la entrada siguiente; el de una escritura, en la misma.
//      · en testbus.c (convención FUSE) cada lectura/escritura registra MC en el T de
//        inicio del ciclo y MR/MW al final; la E/S registra PR/PW en inicio+1.
//      · Correspondencia (comprobada en los JSON: M1 de 4 T y lectura de 3 T tienen la
//        señal en el T 1 del ciclo; la E/S en el T 2): T_json = T(MC previo) + 1 para
//        memoria y T_json = T(PR/PW) + 1 para E/S.
//
// QUÉ NO SE COMPARA (y por qué):
//  - La dirección del bus en los T sin acceso (ciclos internos, refresco). El JSON pone
//    la dirección de refresco I·256+R en los T 2–3 del M1 y "la última dirección" en
//    los internos; testbus sólo registra MC con la dirección que la CPU pasa a
//    bus_contend, que es la que importa para la contención en el 48K (la de Fuse) y
//    no tiene por qué coincidir con la elegida por el generador del JSON.
//  - El reparto de los T internos (p. ej. hl:1 ×2 frente a un tick de 2): no se ve en
//    el JSON sin ambigüedad. El total de T sí se compara.
//  - El estado HALT: el JSON no lo trae.
//
// AMBIGÜEDADES QUE SE TOLERAN (documentadas; no son exclusiones de casos):
//  - Lectura "fantasma": Fuse modela algunos ciclos como contend_read sin lectura real
//    (p. ej. el desplazamiento de JR cc no tomado: "contend_read(PC,3); PC++"), y sus
//    tests.expected registran sólo MC, sin MR. El JSON registra la lectura. Se acepta
//    un MC sin MR en el mismo T y dirección que una lectura del JSON (no se compara el
//    valor, que la CPU no ha leído). El timing sigue comparándose.
//  - PC durante HALT: el JSON deja PC = dirección de HALT + 1; Fuse (y sus
//    tests.expected, que C1 debe pasar al 100 %) dejan PC en el HALT y lo avanzan al
//    aceptar la INT. Se acepta pc == final.pc − 1 si la CPU indica halted = 1.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { RegsView } from "../../../web/src/emu/regs";
import { FIXTURES, instantiate } from "../../util/wasm";

const DIR = join(FIXTURES, "singlestep", "v1");
const FULL = process.env.ZX_FULL === "1";
const PER_FILE = FULL ? 1000 : 25;

interface SstState {
  pc: number; sp: number; a: number; b: number; c: number; d: number; e: number; f: number; h: number; l: number;
  i: number; r: number; ei: number; wz: number; ix: number; iy: number;
  af_: number; bc_: number; de_: number; hl_: number; im: number; p: number; q: number; iff1: number; iff2: number;
  ram: Array<[number, number]>;
}
interface SstCase {
  name: string;
  initial: SstState;
  final: SstState;
  cycles: Array<[number | null, number | null, string]>;
  ports?: Array<[number, number, "r" | "w"]>;
}

/** Lee sólo los primeros `n` casos de un JSON compacto (fast) o el fichero entero. */
function loadCases(file: string, n: number): SstCase[] {
  if (n >= 1000) return JSON.parse(readFileSync(file, "utf8")) as SstCase[];
  const fd = openSync(file, "r");
  try {
    const marker = Buffer.from('{"name":');
    let buf = Buffer.alloc(0);
    let pos = 0;
    const chunk = Buffer.alloc(64 * 1024);
    for (;;) {
      const got = readSync(fd, chunk, 0, chunk.length, pos);
      pos += got;
      buf = Buffer.concat([buf, chunk.subarray(0, got)]);
      // Busca el inicio del caso n+1: todo lo anterior son n casos completos.
      let idx = -1;
      let count = 0;
      let from = 0;
      for (;;) {
        const k = buf.indexOf(marker, from);
        if (k < 0) break;
        count++;
        if (count === n + 1) { idx = k; break; }
        from = k + 1;
      }
      if (idx >= 0) {
        const text = buf.subarray(0, idx).toString("utf8").replace(/,\s*$/, "") + "]";
        return JSON.parse(text) as SstCase[];
      }
      if (got === 0) return JSON.parse(buf.toString("utf8")) as SstCase[];
    }
  } finally {
    closeSync(fd);
  }
}

type X = Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory };

interface Access { t: number; type: "mr" | "mw" | "ir" | "iw" | "mc"; addr: number; value: number }

function expectedAccesses(c: SstCase): Access[] {
  const out: Access[] = [];
  c.cycles.forEach(([addr, data, pins], i) => {
    const r = pins[0] === "r", w = pins[1] === "w", m = pins[2] === "m", io = pins[3] === "i";
    if (!(r || w) || !(m || io)) return;
    const value = r ? (c.cycles[i + 1]?.[1] ?? -1) : (data ?? -1);
    out.push({ t: i, type: m ? (r ? "mr" : "mw") : (r ? "ir" : "iw"), addr: addr ?? -1, value: value ?? -1 });
  });
  return out;
}

const hex = (v: number, w = 4) => v.toString(16).padStart(w, "0");
const fmtAcc = (a: Access | undefined) => (a ? `${a.t}:${a.type} ${hex(a.addr)}=${hex(a.value, 2)}` : "—");

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".json")).sort() : [];

describe.skipIf(files.length === 0)(`CPU-02 SingleStepTests (${FULL ? "full" : "fast"}, ${PER_FILE} casos/opcode)`, () => {
  let x: X;
  let mem: Uint8Array;
  let regs: RegsView;

  beforeAll(async () => {
    x = (await instantiate("core-test")).exports as unknown as X;
    x.tb_reset!();
    mem = new Uint8Array(x.memory.buffer, x.tb_mem!(), 65536);
    regs = new RegsView(x.memory, x.tb_regs!());
  });

  /** Ejecuta un caso y devuelve la primera discrepancia (o null). */
  function runCase(c: SstCase): string | null {
    const s = c.initial;
    for (const [a, v] of s.ram) mem[a] = v;
    regs.set16("af", (s.a << 8) | s.f);
    regs.set16("bc", (s.b << 8) | s.c);
    regs.set16("de", (s.d << 8) | s.e);
    regs.set16("hl", (s.h << 8) | s.l);
    regs.set16("af_", s.af_); regs.set16("bc_", s.bc_); regs.set16("de_", s.de_); regs.set16("hl_", s.hl_);
    regs.set16("ix", s.ix); regs.set16("iy", s.iy); regs.set16("sp", s.sp); regs.set16("pc", s.pc);
    regs.set16("memptr", s.wz);
    regs.set8("i", s.i); regs.set8("r", s.r);
    regs.set8("iff1", s.iff1); regs.set8("iff2", s.iff2); regs.set8("im", s.im);
    regs.set8("halted", 0); regs.set8("q", s.q); regs.set8("ei_delay", s.ei); regs.set8("ld_air", s.p);

    const reads = (c.ports ?? []).filter((p) => p[2] === "r");
    const q = new Uint8Array(x.memory.buffer, x.tb_port_queue!(), 256);
    reads.forEach((p, i) => { q[i] = p[1]; });
    x.tb_port_queue_set!(reads.length);
    x.tb_set_tstates!(0);
    x.tb_log_enable!(1);
    // Una instrucción del JSON = una llamada a z80_step. z80.c sólo parte un paso en
    // un prefijo DD/FD seguido de otro DD/FD (el primero es un NOP de 4 T y el paso
    // acaba con el segundo pendiente en ei_delay), y SingleStepTests no tiene casos
    // así ("DD 00" y similares son un paso). La guarda de hasta 4 pasos más es sólo
    // una red: si algún caso necesitara más de un paso, cubre sus T.
    const total = c.cycles.length;
    x.tb_step!();
    for (let guard = 0; x.tb_tstates!() < total && guard < 4; guard++) x.tb_step!();

    const errs: string[] = [];
    const f = c.final;
    const R = regs.snapshot();
    const want: Array<[string, number, number]> = [
      ["a", R.af >> 8, f.a], ["f", R.af & 0xff, f.f], ["b", R.bc >> 8, f.b], ["c", R.bc & 0xff, f.c],
      ["d", R.de >> 8, f.d], ["e", R.de & 0xff, f.e], ["h", R.hl >> 8, f.h], ["l", R.hl & 0xff, f.l],
      ["af_", R.af_, f.af_], ["bc_", R.bc_, f.bc_], ["de_", R.de_, f.de_], ["hl_", R.hl_, f.hl_],
      ["ix", R.ix, f.ix], ["iy", R.iy, f.iy], ["sp", R.sp, f.sp], ["pc", R.pc, f.pc],
      ["i", R.i, f.i], ["r", R.r, f.r], ["wz", R.memptr, f.wz],
      ["iff1", R.iff1, f.iff1], ["iff2", R.iff2, f.iff2], ["im", R.im, f.im],
      ["q", R.q, f.q], ["ei", R.ei_delay, f.ei], ["p", R.ld_air, f.p],
    ];
    // PC durante HALT: ver AMBIGÜEDADES en la cabecera.
    if (R.halted === 1 && R.pc === ((f.pc - 1) & 0xffff)) want.find((w) => w[0] === "pc")![1] = f.pc;
    for (const [n, got, exp] of want) if (got !== exp) errs.push(`${n}=${hex(got, 2)} (esperado ${hex(exp, 2)})`);
    for (const [a, v] of f.ram) if (mem[a] !== v) errs.push(`mem[${hex(a)}]=${hex(mem[a]!, 2)} (esperado ${hex(v, 2)})`);
    const T = x.tb_tstates!();
    if (T !== total) errs.push(`T=${T} (esperado ${total})`);

    // Accesos de bus.
    const n = x.tb_event_count!();
    const dv = new DataView(x.memory.buffer, x.tb_events!(), n * 8);
    const got: Access[] = [];
    for (let i = 0; i < n; i++) {
      const t = dv.getUint32(i * 8, true), addr = dv.getUint16(i * 8 + 4, true), kind = dv.getUint8(i * 8 + 6), value = dv.getUint8(i * 8 + 7);
      const nextKind = i + 1 < n ? dv.getUint8((i + 1) * 8 + 6) : -1;
      // MC seguido de MR/MW = inicio de ese acceso; MC suelto = ciclo sin acceso (o
      // lectura fantasma de Fuse), se guarda como "mc" por si casa con una lectura.
      if (kind === 0 && nextKind !== 1 && nextKind !== 2) got.push({ t: t + 1, type: "mc", addr, value: 0 });
      else if (kind === 1 || kind === 2) {
        const start = i > 0 && dv.getUint8((i - 1) * 8 + 6) === 0 ? dv.getUint32((i - 1) * 8, true) : -2;
        got.push({ t: start + 1, type: kind === 1 ? "mr" : "mw", addr, value });
      } else if (kind === 3) got.push({ t: t + 1, type: "ir", addr, value });
      else if (kind === 4) got.push({ t: t + 1, type: "iw", addr, value });
    }
    const exp = expectedAccesses(c);
    let gi = 0;
    for (let ei = 0; ei <= exp.length; ei++) {
      const e = exp[ei];
      // Saltar ciclos sin acceso salvo que sean la lectura fantasma de este acceso.
      while (gi < got.length && got[gi]!.type === "mc" && !(e && e.type === "mr" && got[gi]!.t === e.t && got[gi]!.addr === e.addr)) gi++;
      const g = got[gi];
      if (!e) {
        if (g) errs.push(`acceso de más: ${fmtAcc(g)}`);
        break;
      }
      const phantom = g?.type === "mc";
      if (!g || g.t !== e.t || (!phantom && (g.type !== e.type || g.addr !== e.addr || g.value !== e.value))) {
        errs.push(`acceso #${ei}: obtenido ${fmtAcc(g)} esperado ${fmtAcc(e)}`);
        break;
      }
      gi++;
    }
    // Puertos (redundante con lo anterior, pero con mensaje propio).
    const gotPorts = got.filter((a) => a.type === "ir" || a.type === "iw").map((a) => `${hex(a.addr)}=${hex(a.value, 2)}${a.type === "ir" ? "r" : "w"}`);
    const expPorts = (c.ports ?? []).map((p) => `${hex(p[0])}=${hex(p[1], 2)}${p[2]}`);
    if (gotPorts.join() !== expPorts.join()) errs.push(`puertos [${gotPorts}] (esperado [${expPorts}])`);

    // Limpieza: la RAM tocada vuelve a 0 para el caso siguiente.
    for (const [a] of s.ram) mem[a] = 0;
    for (const [a] of f.ram) mem[a] = 0;
    for (const a of got) if (a.type === "mw") mem[a.addr] = 0;

    if (!errs.length) return null;
    const init = `pc=${hex(s.pc)} af=${hex((s.a << 8) | s.f)} bc=${hex((s.b << 8) | s.c)} hl=${hex((s.h << 8) | s.l)} sp=${hex(s.sp)} wz=${hex(s.wz)} q=${hex(s.q, 2)}`;
    return `${c.name} [${init}]: ${errs.slice(0, 6).join("; ")}`;
  }

  for (const file of files) {
    it(file.replace(/\.json$/, ""), () => {
      const cases = loadCases(join(DIR, file), PER_FILE);
      const fails: string[] = [];
      for (const c of cases) {
        const r = runCase(c);
        if (r) fails.push(r);
      }
      expect(fails.length, `${fails.length}/${cases.length} casos fallan; primero: ${fails[0] ?? ""}`).toBe(0);
    });
  }
});
