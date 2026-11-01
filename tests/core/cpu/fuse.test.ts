// CPU-01 (docs/TEST-PLAN.md §2): suite de la CPU de Fuse sobre core-test.wasm.
// Compara registros (incluido MEMPTR), I, R, IFF1/2, IM, HALT, T-states, la memoria
// completa (inicial + bloques esperados) y la lista completa de eventos de bus.
//
// Dos excepciones (decisión del coordinador): en los bloques de E/S y CP repetidos que
// se interrumpen en la iteración que repite, Fuse no modela los flags medidos en silicio
// (David Banks 2018, exigidos por z80test de Rak). En esos casos se compara todo salvo F.
// En INxR/OTxR que repiten tampoco el MEMPTR: Fuse da BC±1; SingleStepTests (capturado
// de hardware) da PC+1, como en LDxR/CPxR. Se compara todo salvo MEMPTR.
const BANKS_FLAGS = new Set(["edb2_1", "edb3_1", "edb9_2", "edbb_1"]);
const BANKS_MEMPTR = new Set(["edb2_1", "edb3_1", "edba_1", "edbb_1"]);
import { beforeAll, describe, expect, it } from "vitest";
import { RegsView } from "../../../web/src/emu/regs";
import { fixture, instantiate } from "../../util/wasm";
import {
  formatEvent, parseFuseExpected, parseFuseIn, REG16_ORDER,
  type FuseExpected, type FuseInput, type FuseState,
} from "./fuse-format";

type Exports = Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory };

const inText = fixture("fuse/tests.in");
const expText = fixture("fuse/tests.expected");
const dec = new TextDecoder();
const inputs: FuseInput[] = inText ? parseFuseIn(dec.decode(inText)) : [];
const expected: FuseExpected[] = expText ? parseFuseExpected(dec.decode(expText)) : [];
const expByName = new Map(expected.map((e) => [e.name, e]));

const hex = (v: number, w = 4) => v.toString(16).padStart(w, "0");

function stateLine(s: FuseState): string {
  return REG16_ORDER.map((r) => `${r}=${hex(s.regs[r])}`).join(" ") +
    ` i=${hex(s.i, 2)} r=${hex(s.r, 2)} iff1=${s.iff1} iff2=${s.iff2} im=${s.im} halted=${s.halted} t=${s.tstates}`;
}

/** Ejecuta un caso y devuelve la descripción de la primera discrepancia, o null. */
function runCase(x: Exports, input: FuseInput, exp: FuseExpected): string | null {
  x.tb_reset!();
  const regs = new RegsView(x.memory, x.tb_regs!());
  for (const r of REG16_ORDER) regs.set16(r, input.state.regs[r]);
  regs.set8("i", input.state.i);
  regs.set8("r", input.state.r);
  regs.set8("iff1", input.state.iff1);
  regs.set8("iff2", input.state.iff2);
  regs.set8("im", input.state.im);
  regs.set8("halted", input.state.halted);
  const mem = new Uint8Array(x.memory.buffer, x.tb_mem!(), 65536);
  const want = new Uint8Array(65536);
  for (const b of input.mem) { mem.set(b.bytes, b.addr); want.set(b.bytes, b.addr); }
  for (const b of exp.mem) want.set(b.bytes, b.addr);
  x.tb_set_tstates!(0);
  x.tb_log_enable!(1);
  x.tb_run!(input.state.tstates);

  const got: FuseState = {
    regs: Object.fromEntries(REG16_ORDER.map((r) => [r, regs.get16(r)])) as FuseState["regs"],
    i: regs.get8("i"), r: regs.get8("r"), iff1: regs.get8("iff1"), iff2: regs.get8("iff2"),
    im: regs.get8("im"), halted: regs.get8("halted"), tstates: x.tb_tstates!(),
  };
  const n = x.tb_event_count!();
  const dv = new DataView(x.memory.buffer, x.tb_events!(), n * 8);
  const events: string[] = [];
  for (let k = 0; k < n; k++)
    events.push(formatEvent(dv.getUint32(k * 8, true), dv.getUint8(k * 8 + 6), dv.getUint16(k * 8 + 4, true), dv.getUint8(k * 8 + 7)));

  const problems: string[] = [];
  if (BANKS_FLAGS.has(input.name)) got.regs.af = (got.regs.af & 0xff00) | (exp.state.regs.af & 0xff);
  if (BANKS_MEMPTR.has(input.name)) got.regs.memptr = exp.state.regs.memptr;
  const g = stateLine(got), e = stateLine(exp.state);
  if (g !== e) problems.push(`estado\n  obtenido: ${g}\n  esperado: ${e}`);
  for (let a = 0; a < 65536; a++) {
    if (mem[a] !== want[a]) { problems.push(`memoria[${hex(a)}] = ${hex(mem[a]!, 2)}, esperado ${hex(want[a]!, 2)}`); break; }
  }
  const len = Math.max(events.length, exp.events.length);
  for (let k = 0; k < len; k++) {
    if (events[k] !== exp.events[k]) {
      const ctx = (list: string[]) => list.slice(Math.max(0, k - 3), k + 4).map((s, j) => (j + Math.max(0, k - 3) === k ? "> " : "  ") + s).join("\n");
      problems.push(`evento #${k}\n obtenido:\n${ctx(events)}\n esperado:\n${ctx(exp.events)}`);
      break;
    }
  }
  return problems.length ? `${input.name}: ${problems.join("\n")}` : null;
}

describe.skipIf(!inText || !expText)("CPU-01 FUSE tests.in", () => {
  let x: Exports;
  beforeAll(async () => {
    x = (await instantiate("core-test")).exports as unknown as Exports;
  });

  it("cada caso de tests.in tiene su tests.expected", () => {
    expect(inputs.length).toBeGreaterThan(1000);
    expect(inputs.filter((c) => !expByName.has(c.name)).map((c) => c.name)).toEqual([]);
  });

  it("todos los casos coinciden (registros, memoria, T-states y eventos)", () => {
    const failures: string[] = [];
    for (const input of inputs) {
      const r = runCase(x, input, expByName.get(input.name)!);
      if (r) failures.push(r);
    }
    const summary = `${inputs.length - failures.length}/${inputs.length} casos OK`;
    if (failures.length) {
      const names = failures.map((f) => f.slice(0, f.indexOf(":"))).join(" ");
      throw new Error(`${summary}\nfallan: ${names}\n\n${failures.slice(0, Number(process.env.FUSE_SHOW ?? 10)).join("\n\n")}`);
    }
    console.log(`FUSE: ${summary}`);
  });
});
