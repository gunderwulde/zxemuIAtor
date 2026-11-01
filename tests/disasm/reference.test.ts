// Tabla de referencia del desensamblador escrita a mano (AGENTS.md §4.3): bytes → texto
// esperado, a partir del manual de Zilog (UM0080, tablas de opcodes) y de Sean Young,
// "The Undocumented Z80 Documented" v0.91 (§4 y tablas CB/ED/DD/FD/DDCB). NO se genera
// desde web/src/z80isa ni desde el desensamblador. Todas en 8000h salvo indicación.
// Formato fijado por D1 (web/src/disasm/index.ts, cabecera): mnemónico a 5 columnas,
// hexadecimal con sufijo h y 0 inicial delante de letra, JR/DJNZ con destino absoluto.
import { describe, expect, it } from "vitest";
import { disassemble, type DisasmKind } from "../../web/src/disasm";

// bytes | texto | longitud | tipo
const REF: [string, string, number, DisasmKind][] = [
  // ---- sin prefijo (Zilog) ----
  ["00", "nop", 1, "insn"],
  ["01 34 12", "ld   bc,1234h", 3, "insn"],
  ["3e ff", "ld   a,0FFh", 2, "insn"],
  ["21 00 40", "ld   hl,4000h", 3, "insn"],
  ["22 cd ab", "ld   (0ABCDh),hl", 3, "insn"],
  ["3a 00 c0", "ld   a,(0C000h)", 3, "insn"],
  ["08", "ex   af,af'", 1, "insn"],
  ["10 fe", "djnz 8000h", 2, "insn"],          // e = -2: salto a sí misma
  ["18 00", "jr   8002h", 2, "insn"],
  ["20 7f", "jr   nz,8081h", 2, "insn"],       // 8002h + 127
  ["38 80", "jr   c,7F82h", 2, "insn"],        // 8002h - 128
  ["76", "halt", 1, "insn"],
  ["7e", "ld   a,(hl)", 1, "insn"],
  ["86", "add  a,(hl)", 1, "insn"],
  ["96", "sub  (hl)", 1, "insn"],
  ["9f", "sbc  a,a", 1, "insn"],
  ["fe 0a", "cp   0Ah", 2, "insn"],
  ["c3 00 80", "jp   8000h", 3, "insn"],
  ["ea 34 12", "jp   pe,1234h", 3, "insn"],
  ["cd 01 16", "call 1601h", 3, "insn"],
  ["fc 34 12", "call m,1234h", 3, "insn"],
  ["c9", "ret", 1, "insn"],
  ["d8", "ret  c", 1, "insn"],
  ["ff", "rst  38h", 1, "insn"],
  ["d7", "rst  10h", 1, "insn"],
  ["d3 fe", "out  (0FEh),a", 2, "insn"],
  ["db 1f", "in   a,(1Fh)", 2, "insn"],
  ["e3", "ex   (sp),hl", 1, "insn"],
  ["e9", "jp   (hl)", 1, "insn"],
  ["f9", "ld   sp,hl", 1, "insn"],
  ["f5", "push af", 1, "insn"],
  // ---- CB ----
  ["cb 00", "rlc  b", 2, "insn"],
  ["cb 3e", "srl  (hl)", 2, "insn"],
  ["cb 37", "sll  a", 2, "insn"],                // Young: SLL no documentada (CB 30-37)
  ["cb 7e", "bit  7,(hl)", 2, "insn"],
  ["cb 87", "res  0,a", 2, "insn"],
  ["cb fe", "set  7,(hl)", 2, "insn"],
  // ---- ED ----
  ["ed 44", "neg", 2, "insn"],
  ["ed 4c", "db   0EDh,4Ch ; neg", 2, "dup"],           // Young: ED 4C/54/… = NEG
  ["ed 4d", "reti", 2, "insn"],
  ["ed 55", "db   0EDh,55h ; retn", 2, "dup"],          // Young: ED x5 = RETN
  ["ed 4e", "db   0EDh,4Eh ; im 0", 2, "dup"],          // Young: ED 4E = IM 0 (o 0/1)
  ["ed 5e", "im   2", 2, "insn"],
  ["ed 70", "in   f,(c)", 2, "insn"],                   // Young: IN (C) / IN F,(C)
  ["ed 71", "out  (c),0", 2, "insn"],                   // Young: OUT (C),0 (NMOS)
  ["ed 78", "in   a,(c)", 2, "insn"],
  ["ed 4a", "adc  hl,bc", 2, "insn"],
  ["ed 72", "sbc  hl,sp", 2, "insn"],
  ["ed 43 34 12", "ld   (1234h),bc", 4, "insn"],
  ["ed 6b 34 12", "db   0EDh,6Bh,34h,12h ; ld hl,(1234h)", 4, "dup"], // forma larga de 2A
  ["ed 57", "ld   a,i", 2, "insn"],
  ["ed 6f", "rld", 2, "insn"],
  ["ed b0", "ldir", 2, "insn"],
  ["ed bb", "otdr", 2, "insn"],
  ["ed 00", "db   0EDh,00h ; nop (ED no asignado)", 2, "ednop"],
  ["ed 77", "db   0EDh,77h ; nop (ED no asignado)", 2, "ednop"],
  ["ed ff", "db   0EDh,0FFh ; nop (ED no asignado)", 2, "ednop"],
  // ---- DD / FD ----
  ["dd 21 00 5c", "ld   ix,5C00h", 4, "insn"],
  ["fd 7e 00", "ld   a,(iy+00h)", 3, "insn"],
  ["dd 77 fe", "ld   (ix-02h),a", 3, "insn"],
  ["dd 36 80 ff", "ld   (ix-80h),0FFh", 4, "insn"],
  ["fd 86 7f", "add  a,(iy+7Fh)", 3, "insn"],
  ["dd 24", "inc  ixh", 2, "insn"],                     // Young: IXH/IXL no documentados
  ["fd 6f", "ld   iyl,a", 2, "insn"],
  ["dd 65", "ld   ixh,ixl", 2, "insn"],
  ["dd 66 01", "ld   h,(ix+01h)", 3, "insn"],           // con (IX+d) H es H, no IXH
  ["fd bd", "cp   iyl", 2, "insn"],
  ["dd e9", "jp   (ix)", 2, "insn"],
  ["fd e3", "ex   (sp),iy", 2, "insn"],
  ["dd 00", "db   0DDh ; prefijo DD sin efecto", 1, "prefix"],   // Young §4.1
  ["fd 47", "db   0FDh ; prefijo FD sin efecto", 1, "prefix"],   // ld b,a no usa HL
  ["dd eb", "db   0DDh ; prefijo DD sin efecto", 1, "prefix"],   // EX DE,HL no cambia
  ["dd dd", "db   0DDh ; prefijo DD sin efecto", 1, "prefix"],
  ["fd ed", "db   0FDh ; prefijo FD sin efecto", 1, "prefix"],
  // ---- DDCB / FDCB (DD CB d op) ----
  ["dd cb 05 06", "rlc  (ix+05h)", 4, "insn"],
  ["fd cb ff 3e", "srl  (iy-01h)", 4, "insn"],
  ["dd cb 00 46", "bit  0,(ix+00h)", 4, "insn"],
  ["dd cb 00 40", "db   0DDh,0CBh,00h,40h ; bit 0,(ix+00h)", 4, "dup"], // Young: z≠6 = z=6
  ["dd cb 10 00", "rlc  (ix+10h),b", 4, "insn"],        // Young §4.3: copia en B
  ["fd cb 02 37", "sll  (iy+02h),a", 4, "insn"],
  ["dd cb 03 87", "res  0,(ix+03h),a", 4, "insn"],
  ["fd cb 80 fe", "set  7,(iy-80h)", 4, "insn"],
];

const bytesOf = (s: string) => s.split(" ").map((h) => parseInt(h, 16));

describe("desensamblador: tabla de referencia a mano", () => {
  for (const [hexBytes, text, len, kind] of REF) {
    it(`${hexBytes} → ${text}`, () => {
      const mem = new Uint8Array(65536);
      const b = bytesOf(hexBytes);
      mem.set(b, 0x8000);
      mem[0x8000 + b.length] = 0xaa; // basura detrás: no debe leerse
      const l = disassemble(mem, 0x8000);
      expect(l.text).toBe(text);
      expect(l.len).toBe(len);
      expect(l.kind).toBe(kind);
      expect(l.bytes).toEqual(b.slice(0, len));
    });
  }

  it("destinos y paso por encima", () => {
    const at = (hexBytes: string, addr = 0x8000) => {
      const mem = new Uint8Array(65536);
      mem.set(bytesOf(hexBytes), addr);
      return disassemble(mem, addr);
    };
    expect(at("cd 34 12")).toMatchObject({ target: 0x1234, stepOver: true });
    expect(at("c4 34 12")).toMatchObject({ target: 0x1234, stepOver: true });
    expect(at("ef")).toMatchObject({ target: 0x28, stepOver: true });
    expect(at("10 fe")).toMatchObject({ target: 0x8000, stepOver: true });
    expect(at("ed b8")).toMatchObject({ target: null, stepOver: true }); // lddr
    expect(at("ed b1")).toMatchObject({ stepOver: true });              // cpir
    expect(at("ed a0")).toMatchObject({ stepOver: false });             // ldi
    expect(at("c3 00 40")).toMatchObject({ target: 0x4000, stepOver: false });
    expect(at("18 fe")).toMatchObject({ target: 0x8000, stepOver: false });
    expect(at("e9")).toMatchObject({ target: null, stepOver: false });
    expect(at("c9")).toMatchObject({ target: null, stepOver: false });
  });

  it("saltos relativos que dan la vuelta a 64 K usan $", () => {
    const mem = new Uint8Array(65536);
    mem.set([0x18, 0x7f], 0xfff0); // FFF2h + 127 = 10071h
    expect(disassemble(mem, 0xfff0).text).toBe("jr   $+129");
    mem.set([0x10, 0x80], 0x0002); // 0004h - 128 = -7Ch
    expect(disassemble(mem, 0x0002).text).toBe("djnz $-126");
  });

  it("lee con la dirección en 16 bits (instrucción partida entre FFFFh y 0000h)", () => {
    const mem = new Uint8Array(65536);
    mem[0xffff] = 0x21; mem[0] = 0x34; mem[1] = 0x12;
    expect(disassemble(mem, 0xffff)).toMatchObject({ text: "ld   hl,1234h", len: 3, bytes: [0x21, 0x34, 0x12] });
  });
});
