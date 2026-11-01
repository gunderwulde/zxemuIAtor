// Tests dirigidos de CPU (docs/TEST-PLAN.md CPU-03…CPU-08) para lo que FUSE no cubre:
// interrupciones, retardo de EI, prefijos, HALT, NMI, R y Q. Valores esperados de
// docs/zx48-hardware.md §2/§9 y de la documentación del Z80 (no del código bajo prueba).
import { beforeEach, describe, expect, it } from "vitest";
import { RegsView } from "../../../web/src/emu/regs";
import { instantiate } from "../../util/wasm";

type Exports = Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory };

let x: Exports;
let regs: RegsView;
let mem: Uint8Array;

beforeEach(async () => {
  x ??= (await instantiate("core-test")).exports as unknown as Exports;
  x.tb_reset!();
  x.tb_log_enable!(1);
  regs = new RegsView(x.memory, x.tb_regs!());
  mem = new Uint8Array(x.memory.buffer, x.tb_mem!(), 65536);
});

function load(addr: number, bytes: number[]) { mem.set(bytes, addr); }
function step(): number { const t0 = x.tb_tstates!(); x.tb_step!(); return x.tb_tstates!() - t0; }
const word = (a: number) => mem[a]! | (mem[(a + 1) & 0xffff]! << 8);

function events(): number[][] {
  const n = x.tb_event_count!();
  const dv = new DataView(x.memory.buffer, x.tb_events!(), n * 8);
  const ev = [];
  for (let k = 0; k < n; k++)
    ev.push([dv.getUint32(k * 8, true), dv.getUint8(k * 8 + 6), dv.getUint16(k * 8 + 4, true), dv.getUint8(k * 8 + 7)]);
  return ev;
}

describe("CPU-07 interrupciones", () => {
  it("IM1: RST 38h en 13 T, IFF1=IFF2=0, R+1, PC apilado", () => {
    load(0x8000, [0x00]);
    regs.set16("pc", 0x8000); regs.set16("sp", 0xc000);
    regs.set8("iff1", 1); regs.set8("iff2", 1); regs.set8("im", 1);
    x.tb_set_int!(1);
    expect(step()).toBe(13);
    expect(regs.get16("pc")).toBe(0x38);
    expect(regs.get16("memptr")).toBe(0x38);
    expect(regs.get16("sp")).toBe(0xbffe);
    expect(word(0xbffe)).toBe(0x8000);
    expect(regs.get8("iff1")).toBe(0);
    expect(regs.get8("iff2")).toBe(0);
    expect(regs.get8("r")).toBe(1);
  });

  it("IM0 con 0xFF en el bus = RST 38h, 13 T", () => {
    regs.set16("sp", 0xc000); regs.set8("iff1", 1); regs.set8("im", 0);
    x.tb_set_int!(1);
    expect(step()).toBe(13);
    expect(regs.get16("pc")).toBe(0x38);
  });

  it("IM2: vector en I*256+bus, 19 T, MEMPTR = PC", () => {
    regs.set16("pc", 0x8000); regs.set16("sp", 0xc000);
    regs.set8("iff1", 1); regs.set8("im", 2); regs.set8("i", 0x90);
    load(0x90ff, [0x34, 0x12]);
    x.tb_set_int!(1);
    expect(step()).toBe(19);
    expect(regs.get16("pc")).toBe(0x1234);
    expect(regs.get16("memptr")).toBe(0x1234);
  });

  it("eventos de bus de INTA: 7 T sin acceso y dos escrituras de pila", () => {
    regs.set16("pc", 0x8000); regs.set16("sp", 0xc000); regs.set8("iff1", 1); regs.set8("im", 1);
    x.tb_set_int!(1);
    step();
    expect(events()).toEqual([[7, 0, 0xbfff, 0], [10, 2, 0xbfff, 0x80], [10, 0, 0xbffe, 0], [13, 2, 0xbffe, 0x00]]);
  });

  it("con IFF1=0 la INT se ignora", () => {
    regs.set8("im", 1);
    x.tb_set_int!(1);
    expect(step()).toBe(4);
    expect(regs.get16("pc")).toBe(1);
  });

  it("EI: se acepta tras la instrucción SIGUIENTE; EI encadenados la bloquean", () => {
    load(0, [0xfb, 0xfb, 0x00, 0x00]);
    regs.set16("sp", 0xc000); regs.set8("im", 1);
    x.tb_set_int!(1);
    step(); expect(regs.get16("pc")).toBe(1); // EI
    step(); expect(regs.get16("pc")).toBe(2); // EI (vuelve a bloquear)
    step(); expect(regs.get16("pc")).toBe(3); // NOP tras EI
    expect(step()).toBe(13);                  // ahora sí
    expect(word(0xbffe)).toBe(3);
  });

  // Cadenas de prefijos (Sean Young, "The Undocumented Z80 Documented" §3.3/§5.3: un
  // DD/FD seguido de otro prefijo actúa como un NOP de 4 T, y la CPU no acepta INT
  // tras un prefijo, sólo tras la instrucción completa). Como Fuse, cada prefijo sin
  // efecto termina el paso (así un bloque de DD no se come miles de T en un z80_step),
  // pero el siguiente paso continúa la instrucción sin mirar /INT.
  it("cadena DD DD 21 nn: el primer DD es un paso de 8 T y la INT no entra antes del opcode", () => {
    load(0, [0xdd, 0xdd, 0x21, 0x34, 0x12]);
    regs.set16("sp", 0xc000); regs.set8("iff1", 1); regs.set8("im", 1);
    expect(step()).toBe(4 + 4);               // DD sin efecto + M1 del segundo DD
    expect(regs.get16("pc")).toBe(2);
    expect(regs.get8("ei_delay")).not.toBe(0);
    x.tb_set_int!(1);
    expect(step()).toBe(10);                  // 21 34 12 con IX: la INT espera
    expect(regs.get16("ix")).toBe(0x1234);
    expect(regs.get16("hl")).toBe(0);
    expect(regs.get8("r")).toBe(3);
    expect(regs.get8("ei_delay")).toBe(0);
    expect(step()).toBe(13);
    expect(word(0xbffe)).toBe(5);
  });

  it("DD FD 21 nn: manda el último prefijo; FD DD CB d op también", () => {
    load(0, [0xdd, 0xfd, 0x21, 0x34, 0x12, 0xfd, 0xdd, 0xcb, 0x01, 0xc6]); // ...; SET 0,(IX+1)
    regs.set16("ix", 0x9000);
    expect(step() + step()).toBe(4 + 4 + 10);
    expect(regs.get16("iy")).toBe(0x1234);
    expect(regs.get16("ix")).toBe(0x9000);
    expect(step() + step()).toBe(4 + 23);
    expect(mem[0x9001]).toBe(0x01);
  });

  it("tb_reset vuelve a activar el registro de eventos", () => {
    x.tb_log_enable!(0);
    x.tb_reset!();
    load(0, [0x00]);
    step();
    expect(x.tb_event_count!()).toBe(2);   // MC + MR del M1
  });

  it("64 KB de DD: cada paso dura 4 u 8 T (no hay bucle infinito)", () => {
    mem.fill(0xdd);
    regs.set8("iff1", 1); regs.set8("im", 1);
    expect(step()).toBe(8);
    let bad = 0;
    for (let i = 0; i < 100000; i++) if (step() !== 4) bad++;
    expect(bad).toBe(0);
    // En medio de la cadena /INT tampoco entra.
    x.tb_set_int!(1);
    expect(step()).toBe(4);
    expect(regs.get8("iff1")).toBe(1);
    mem.fill(0);
  });

  it("INT durante HALT: sale y apila la dirección siguiente al HALT", () => {
    load(0x8000, [0x76]);
    regs.set16("pc", 0x8000); regs.set16("sp", 0xc000); regs.set8("iff1", 1); regs.set8("im", 1);
    step();
    expect(regs.get8("halted")).toBe(1);
    expect(step()).toBe(4);
    expect(step()).toBe(4);
    expect(regs.get8("r")).toBe(3);
    x.tb_set_int!(1);
    expect(step()).toBe(13);
    expect(regs.get8("halted")).toBe(0);
    expect(word(0xbffe)).toBe(0x8001);
  });

  it("NMI: 11 T, IFF1=0, IFF2 se conserva, PC=0x66; RETN restaura IFF1", () => {
    load(0x0066, [0xed, 0x45]);
    regs.set16("pc", 0x8000); regs.set16("sp", 0xc000); regs.set8("iff1", 1); regs.set8("iff2", 1);
    const t0 = x.tb_tstates!();
    x.tb_nmi!();
    expect(x.tb_tstates!() - t0).toBe(11);
    expect(regs.get16("pc")).toBe(0x66);
    expect(regs.get8("iff1")).toBe(0);
    expect(regs.get8("iff2")).toBe(1);
    expect(step()).toBe(14);
    expect(regs.get16("pc")).toBe(0x8000);
    expect(regs.get8("iff1")).toBe(1);
  });

  it("INT justo tras LD A,I deja P/V a 0 (bug NMOS); sin INT P/V = IFF2", () => {
    load(0, [0xed, 0x57]);
    regs.set16("sp", 0xc000); regs.set8("iff1", 1); regs.set8("iff2", 1); regs.set8("im", 1);
    step();
    expect(regs.get16("af") & 0x04).toBe(0x04);
    x.tb_set_int!(1);
    step();
    expect(regs.get16("pc")).toBe(0x38);
    expect(regs.get16("af") & 0x04).toBe(0);
  });
});

describe("CPU-05 registro R", () => {
  it("+1 por M1: CB y ED cuentan 2, DDCB 2, el bit 7 se conserva", () => {
    load(0, [0xcb, 0x00, 0xed, 0x00, 0xdd, 0xcb, 0x00, 0x06, 0x00]);
    regs.set8("r", 0xfe);
    step(); expect(regs.get8("r")).toBe(0x80);
    step(); expect(regs.get8("r")).toBe(0x82);
    step(); expect(regs.get8("r")).toBe(0x84);
    step(); expect(regs.get8("r")).toBe(0x85);
  });

  it("LD R,A fija los 8 bits (9 T)", () => {
    load(0, [0xed, 0x4f]);
    regs.set16("af", 0x8100);
    expect(step()).toBe(9);
    expect(regs.get8("r")).toBe(0x81);
  });
});

describe("CPU-06 prefijos e instrucciones no documentadas", () => {
  it("ED inválido: 8 T, R+2, sin efecto", () => {
    load(0, [0xed, 0x00]);
    expect(step()).toBe(8);
    expect(regs.get16("pc")).toBe(2);
    expect(regs.get8("r")).toBe(2);
  });

  it("DDCB con registro escribe en memoria y en el registro (H real), 23 T", () => {
    load(0, [0xdd, 0xcb, 0x01, 0x04]); // RLC (IX+1),H
    load(0x9001, [0x81]);
    regs.set16("ix", 0x9000);
    regs.set16("hl", 0x0000);
    expect(step()).toBe(23);
    expect(mem[0x9001]).toBe(0x03);
    expect(regs.get16("hl")).toBe(0x0300);
    expect(regs.get16("ix")).toBe(0x9000);
  });

  it("LD H,(IX+d) usa H real; LD IXH,n usa IXH", () => {
    load(0, [0xdd, 0x66, 0x02, 0xdd, 0x26, 0x55]);
    load(0x9002, [0xaa]);
    regs.set16("ix", 0x9000);
    expect(step()).toBe(19);
    expect(regs.get16("hl")).toBe(0xaa00);
    step();
    expect(regs.get16("ix")).toBe(0x5500);
  });

  it("OUT (C),0 escribe 0", () => {
    load(0, [0xed, 0x71]);
    regs.set16("bc", 0x12fe);
    step();
    const pw = events().filter((e) => e[1] === 4);
    expect(pw).toEqual([[9, 4, 0x12fe, 0]]);
  });
});

describe("CPU-03 Q en SCF/CCF", () => {
  it("SCF tras instrucción que tocó flags: XF/YF = A", () => {
    load(0, [0xb7, 0x37]); // OR A ; SCF
    regs.set16("af", 0x0000);
    step(); step();
    expect(regs.get16("af") & 0x28).toBe(0x00);
  });

  it("SCF tras instrucción que no tocó flags: XF/YF = F | A", () => {
    load(0, [0x00, 0x37]); // NOP ; SCF
    regs.set16("af", 0x0028);
    step(); step();
    expect(regs.get16("af") & 0x28).toBe(0x28);
  });
});

describe("CPU-03 bloque interrumpido (Banks 2018)", () => {
  it("LDIR que repite: 21 T, XF/YF de los bits 11 y 13 del PC, MEMPTR = PC+1", () => {
    load(0x2800, [0xed, 0xb0]);
    regs.set16("pc", 0x2800); regs.set16("bc", 2); regs.set16("hl", 0x9000); regs.set16("de", 0xa000);
    regs.set16("af", 0x0000);
    expect(step()).toBe(21);
    expect(regs.get16("pc")).toBe(0x2800);
    expect(regs.get16("af") & 0x28).toBe(0x28);
    expect(regs.get16("memptr")).toBe(0x2801);
  });
});
