// CPU-20 (docs/TEST-PLAN.md §3): zexdoc y zexall (Frank Cringle, versión de agn453)
// sobre core-test.wasm con un CP/M mínimo:
//   0x0000  HALT: el programa termina con JP 0 (se detecta PC=0 + halted)
//   0x0005  trampa BDOS (tb_run_to para en PC=5): C=2 imprime E, C=9 imprime (DE) hasta '$';
//           luego se emula el RET sacando la dirección de la pila
//   0x0006  palabra con la cima de la TPA: los zex la usan como SP inicial
// Aceptación: ningún "ERROR" en la salida y el mensaje final de fin de pruebas.
import { describe, expect, it } from "vitest";
import { RegsView } from "../../../web/src/emu/regs";
import { fixture, instantiate } from "../../util/wasm";

type Exports = Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory };

const CHUNK = 1_000_000_000; // T-states por llamada a tb_run_to (se pone t a 0 en cada una)

async function runCpm(com: Uint8Array, log: (s: string) => void): Promise<{ out: string; tstates: number }> {
  const x = (await instantiate("core-test")).exports as unknown as Exports;
  x.tb_reset!();
  x.tb_log_enable!(0);
  const mem = new Uint8Array(x.memory.buffer, x.tb_mem!(), 65536);
  const regs = new RegsView(x.memory, x.tb_regs!());
  mem.set(com, 0x100);
  mem[0x0000] = 0x76;
  mem[0x0005] = 0xc9;
  mem[0x0006] = 0x00;
  mem[0x0007] = 0xf0;
  regs.set16("pc", 0x100);
  regs.set16("sp", 0xf000);
  let out = "", line = "", total = 0;
  const put = (c: number) => {
    const ch = String.fromCharCode(c);
    out += ch;
    if (ch === "\n") { log(line.replace(/\r/g, "")); line = ""; } else line += ch;
  };
  for (;;) {
    x.tb_set_tstates!(0);
    total += x.tb_run_to!(CHUNK, 0x0005);
    const pc = regs.get16("pc");
    if (pc === 0x0000 && regs.get8("halted")) break;
    if (pc !== 0x0005) continue;
    const c = regs.get16("bc") & 0xff;
    if (c === 2) put(regs.get16("de") & 0xff);
    else if (c === 9) for (let a = regs.get16("de"); mem[a] !== 0x24; a = (a + 1) & 0xffff) put(mem[a]!);
    const sp = regs.get16("sp");
    regs.set16("pc", mem[sp]! | (mem[(sp + 1) & 0xffff]! << 8));
    regs.set16("sp", (sp + 2) & 0xffff);
  }
  if (line) log(line);
  return { out, tstates: total };
}

const TIMEOUT = 30 * 60_000;

describe("CPU-20 zexdoc / zexall", () => {
  for (const name of ["zexdoc", "zexall"]) {
    const com = fixture(`zex/${name}.com`);
    it.skipIf(!com)(`${name}: sin ERROR`, async () => {
      const t0 = performance.now();
      const { out, tstates } = await runCpm(com!, (s) => console.log(`[${name}] ${s}`));
      const secs = (performance.now() - t0) / 1000;
      console.log(`[${name}] ${tstates.toLocaleString("en")} T en ${secs.toFixed(1)} s` +
        (secs > 180 ? "  AVISO: más de 3 minutos" : ""));
      expect(out).not.toMatch(/ERROR/);
      expect(out).toMatch(/Tests complete/);
    }, TIMEOUT);
  }
});
