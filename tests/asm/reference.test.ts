// Tabla de referencia escrita a mano a partir del manual de Zilog (UM0080, tablas de
// opcodes) y de Sean Young, "The Undocumented Z80 Documented" v0.91 (§7 tablas CB, ED,
// DD/FD y DDCB/FDCB). NO se genera desde web/src/z80isa: es el oráculo independiente.
// Al menos una instrucción por fila/grupo de cada tabla. Convención: nn=1234h, n=12h,
// d=05h salvo indicación. Los saltos relativos usan '$' (JR $ → 18 FE).
import { describe, expect, it } from "vitest";
import { assemble } from "../../web/src/asm/index";

const REF = `
; ---- sin prefijo: fila x=0 ----
nop                 | 00
ld bc,1234h         | 01 34 12
ld (bc),a           | 02
inc bc              | 03
inc b               | 04
dec b               | 05
ld b,12h            | 06 12
rlca                | 07
ex af,af'           | 08
add hl,bc           | 09
ld a,(bc)           | 0a
dec bc              | 0b
inc c               | 0c
dec c               | 0d
ld c,12h            | 0e 12
rrca                | 0f
djnz $              | 10 fe
ld de,1234h         | 11 34 12
ld (de),a           | 12
inc de              | 13
inc d               | 14
dec d               | 15
ld d,12h            | 16 12
rla                 | 17
jr $                | 18 fe
add hl,de           | 19
ld a,(de)           | 1a
dec de              | 1b
inc e               | 1c
dec e               | 1d
ld e,12h            | 1e 12
rra                 | 1f
jr nz,$             | 20 fe
ld hl,1234h         | 21 34 12
ld (1234h),hl       | 22 34 12
inc hl              | 23
inc h               | 24
dec h               | 25
ld h,12h            | 26 12
daa                 | 27
jr z,$              | 28 fe
add hl,hl           | 29
ld hl,(1234h)       | 2a 34 12
dec hl              | 2b
inc l               | 2c
dec l               | 2d
ld l,12h            | 2e 12
cpl                 | 2f
jr nc,$             | 30 fe
ld sp,1234h         | 31 34 12
ld (1234h),a        | 32 34 12
inc sp              | 33
inc (hl)            | 34
dec (hl)            | 35
ld (hl),12h         | 36 12
scf                 | 37
jr c,$              | 38 fe
add hl,sp           | 39
ld a,(1234h)        | 3a 34 12
dec sp              | 3b
inc a               | 3c
dec a               | 3d
ld a,12h            | 3e 12
ccf                 | 3f
; ---- x=1: LD r,r' y HALT ----
ld b,b              | 40
ld b,c              | 41
ld b,(hl)           | 46
ld c,a              | 4f
ld d,e              | 53
ld e,h              | 5c
ld h,l              | 65
ld l,(hl)           | 6e
ld (hl),b           | 70
ld (hl),l           | 75
halt                | 76
ld (hl),a           | 77
ld a,(hl)           | 7e
ld a,a              | 7f
; ---- x=2: ALU A,r ----
add a,b             | 80
add a,(hl)          | 86
adc a,c             | 89
adc a,a             | 8f
sub d               | 92
sub (hl)            | 96
sbc a,e             | 9b
and h               | a4
xor l               | ad
xor a               | af
or (hl)             | b6
cp b                | b8
cp a                | bf
; ---- x=3 ----
ret nz              | c0
pop bc              | c1
jp nz,1234h         | c2 34 12
jp 1234h            | c3 34 12
call nz,1234h       | c4 34 12
push bc             | c5
add a,12h           | c6 12
rst 0               | c7
ret z               | c8
ret                 | c9
jp z,1234h          | ca 34 12
call z,1234h        | cc 34 12
call 1234h          | cd 34 12
adc a,12h           | ce 12
rst 8               | cf
ret nc              | d0
pop de              | d1
jp nc,1234h         | d2 34 12
out (0feh),a        | d3 fe
call nc,1234h       | d4 34 12
push de             | d5
sub 12h             | d6 12
rst 10h             | d7
ret c               | d8
exx                 | d9
jp c,1234h          | da 34 12
in a,(0feh)         | db fe
call c,1234h        | dc 34 12
sbc a,12h           | de 12
rst 18h             | df
ret po              | e0
pop hl              | e1
jp po,1234h         | e2 34 12
ex (sp),hl          | e3
call po,1234h       | e4 34 12
push hl             | e5
and 12h             | e6 12
rst 20h             | e7
ret pe              | e8
jp (hl)             | e9
jp pe,1234h         | ea 34 12
ex de,hl            | eb
call pe,1234h       | ec 34 12
xor 12h             | ee 12
rst 28h             | ef
ret p               | f0
pop af              | f1
jp p,1234h          | f2 34 12
di                  | f3
call p,1234h        | f4 34 12
push af             | f5
or 12h              | f6 12
rst 30h             | f7
ret m               | f8
ld sp,hl            | f9
jp m,1234h          | fa 34 12
ei                  | fb
call m,1234h        | fc 34 12
cp 12h              | fe 12
rst 38h             | ff
; ---- CB: rotaciones/desplazamientos (SLL no documentada) ----
rlc b               | cb 00
rrc c               | cb 09
rl d                | cb 12
rr e                | cb 1b
sla h               | cb 24
sra l               | cb 2d
sll (hl)            | cb 36
sll b               | cb 30
srl a               | cb 3f
rlc (hl)            | cb 06
; ---- CB: BIT/RES/SET ----
bit 0,b             | cb 40
bit 3,a             | cb 5f
bit 7,(hl)          | cb 7e
res 0,b             | cb 80
res 4,(hl)          | cb a6
res 7,a             | cb bf
set 0,b             | cb c0
set 5,e             | cb eb
set 7,(hl)          | cb fe
; ---- ED ----
in b,(c)            | ed 40
out (c),b           | ed 41
sbc hl,bc           | ed 42
ld (1234h),bc       | ed 43 34 12
neg                 | ed 44
retn                | ed 45
im 0                | ed 46
ld i,a              | ed 47
in c,(c)            | ed 48
out (c),c           | ed 49
adc hl,bc           | ed 4a
ld bc,(1234h)       | ed 4b 34 12
reti                | ed 4d
ld r,a              | ed 4f
in d,(c)            | ed 50
out (c),d           | ed 51
sbc hl,de           | ed 52
ld (1234h),de       | ed 53 34 12
im 1                | ed 56
ld a,i              | ed 57
in e,(c)            | ed 58
out (c),e           | ed 59
adc hl,de           | ed 5a
ld de,(1234h)       | ed 5b 34 12
im 2                | ed 5e
ld a,r              | ed 5f
in h,(c)            | ed 60
out (c),h           | ed 61
sbc hl,hl           | ed 62
rrd                 | ed 67
in l,(c)            | ed 68
out (c),l           | ed 69
adc hl,hl           | ed 6a
rld                 | ed 6f
in f,(c)            | ed 70
in (c)              | ed 70
out (c),0           | ed 71
sbc hl,sp           | ed 72
ld (1234h),sp       | ed 73 34 12
in a,(c)            | ed 78
out (c),a           | ed 79
adc hl,sp           | ed 7a
ld sp,(1234h)       | ed 7b 34 12
ldi                 | ed a0
cpi                 | ed a1
ini                 | ed a2
outi                | ed a3
ldd                 | ed a8
cpd                 | ed a9
ind                 | ed aa
outd                | ed ab
ldir                | ed b0
cpir                | ed b1
inir                | ed b2
otir                | ed b3
lddr                | ed b8
cpdr                | ed b9
indr                | ed ba
otdr                | ed bb
; ---- DD (IX), documentadas ----
add ix,bc           | dd 09
add ix,de           | dd 19
ld ix,1234h         | dd 21 34 12
ld (1234h),ix       | dd 22 34 12
inc ix              | dd 23
add ix,ix           | dd 29
ld ix,(1234h)       | dd 2a 34 12
dec ix              | dd 2b
inc (ix+5)          | dd 34 05
dec (ix-1)          | dd 35 ff
ld (ix+2),12h       | dd 36 02 12
add ix,sp           | dd 39
ld b,(ix+5)         | dd 46 05
ld c,(ix+5)         | dd 4e 05
ld h,(ix+5)         | dd 66 05
ld l,(ix+5)         | dd 6e 05
ld (ix+5),b         | dd 70 05
ld (ix+5),h         | dd 74 05
ld (ix+5),l         | dd 75 05
ld (ix+5),a         | dd 77 05
ld a,(ix+5)         | dd 7e 05
ld a,(ix)           | dd 7e 00
ld a,(ix-128)       | dd 7e 80
ld a,(ix+127)       | dd 7e 7f
add a,(ix+5)        | dd 86 05
adc a,(ix+5)        | dd 8e 05
sub (ix+5)          | dd 96 05
sbc a,(ix+5)        | dd 9e 05
and (ix+5)          | dd a6 05
xor (ix+5)          | dd ae 05
or (ix+5)           | dd b6 05
cp (ix+5)           | dd be 05
pop ix              | dd e1
ex (sp),ix          | dd e3
push ix             | dd e5
jp (ix)             | dd e9
ld sp,ix            | dd f9
; ---- DD: IXH/IXL no documentadas ----
inc ixh             | dd 24
dec ixh             | dd 25
ld ixh,12h          | dd 26 12
inc ixl             | dd 2c
dec ixl             | dd 2d
ld ixl,12h          | dd 2e 12
ld b,ixh            | dd 44
ld b,ixl            | dd 45
ld e,ixl            | dd 5d
ld ixh,b            | dd 60
ld ixh,ixh          | dd 64
ld ixh,ixl          | dd 65
ld ixh,a            | dd 67
ld ixl,c            | dd 69
ld ixl,ixh          | dd 6c
ld a,ixh            | dd 7c
ld a,ixl            | dd 7d
add a,ixh           | dd 84
add a,ixl           | dd 85
adc a,ixl           | dd 8d
sub ixh             | dd 94
sbc a,ixh           | dd 9c
and ixl             | dd a5
xor ixh             | dd ac
or ixh              | dd b4
cp ixl              | dd bd
; ---- FD (IY) ----
add iy,bc           | fd 09
ld iy,1234h         | fd 21 34 12
ld (1234h),iy       | fd 22 34 12
add iy,iy           | fd 29
ld iy,(1234h)       | fd 2a 34 12
inc (iy+5)          | fd 34 05
ld (iy-2),12h       | fd 36 fe 12
ld a,(iy+5)         | fd 7e 05
ld (iy+5),c         | fd 71 05
cp (iy+5)           | fd be 05
pop iy              | fd e1
ex (sp),iy          | fd e3
push iy             | fd e5
jp (iy)             | fd e9
ld sp,iy            | fd f9
inc iyh             | fd 24
ld iyl,12h          | fd 2e 12
ld iyh,iyl          | fd 65
ld d,iyh            | fd 54
ld iyl,a            | fd 6f
and iyh             | fd a4
; ---- DDCB / FDCB documentadas ----
rlc (ix+5)          | dd cb 05 06
rrc (ix+5)          | dd cb 05 0e
rl (ix+5)           | dd cb 05 16
rr (ix+5)           | dd cb 05 1e
sla (ix+5)          | dd cb 05 26
sra (ix+5)          | dd cb 05 2e
srl (ix+5)          | dd cb 05 3e
bit 0,(ix+5)        | dd cb 05 46
bit 7,(ix+5)        | dd cb 05 7e
res 0,(ix+5)        | dd cb 05 86
res 7,(ix+5)        | dd cb 05 be
set 0,(ix+5)        | dd cb 05 c6
set 7,(ix+5)        | dd cb 05 fe
rlc (iy+5)          | fd cb 05 06
bit 5,(iy-2)        | fd cb fe 6e
set 2,(iy+0)        | fd cb 00 d6
; ---- DDCB / FDCB no documentadas ----
sll (ix+5)          | dd cb 05 36
rlc (ix+5),b        | dd cb 05 00
rrc (ix+5),c        | dd cb 05 09
rl (ix+5),d         | dd cb 05 12
rr (ix+5),e         | dd cb 05 1b
sla (ix+5),h        | dd cb 05 24
sra (ix+5),l        | dd cb 05 2d
sll (ix+5),c        | dd cb 05 31
srl (ix+5),a        | dd cb 05 3f
res 3,(ix+5),e      | dd cb 05 9b
set 6,(ix+5),h      | dd cb 05 f4
set 1,(iy+3),l      | fd cb 03 cd
ld b,rlc (ix+5)     | dd cb 05 00
ld a,set 7,(ix+5)   | dd cb 05 ff
ld l,res 0,(iy-1)   | fd cb ff 85
; ---- alias de sintaxis ----
sl1 b               | cb 30
sli a               | cb 37
ld a,xh             | dd 7c
ld hx,12h           | dd 26 12
ld yl,a             | fd 6f
ld a,ly             | fd 7d
ex af,af            | 08
jp hl               | e9
jp ix               | dd e9
add b               | 80
sub a,b             | 90
cp a,(hl)           | be
and a,0dfh          | e6 df
xor a,(hl)          | ae
LD A,(IX+5)         | dd 7e 05
Ld Hl,1234H         | 21 34 12
`;

interface Case { src: string; bytes: number[]; line: number }

function parseRef(): Case[] {
  const out: Case[] = [];
  REF.split("\n").forEach((l, i) => {
    if (!l.trim() || l.trimStart().startsWith(";")) return;
    const [src, hex] = l.split("|");
    out.push({ src: src!.trim(), bytes: hex!.trim().split(/\s+/).map((h) => parseInt(h, 16)), line: i });
  });
  return out;
}

function bytesOf(src: string): number[] {
  const r = assemble("\torg 8000h\n\t" + src + "\n");
  const errs = r.errors.filter((e) => e.severity === "error");
  if (errs.length) throw new Error(`${src}: ${errs.map((e) => e.msg).join("; ")}`);
  return r.segments.length ? [...r.segments[0]!.bytes] : [];
}

const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, "0")).join(" ");

describe("tabla de referencia (Zilog + Sean Young)", () => {
  const cases = parseRef();
  it("tiene una muestra suficiente", () => {
    expect(cases.length).toBeGreaterThan(300);
  });
  it.each(cases.map((c) => [c.src, c] as const))("%s", (_s, c) => {
    expect(hex(bytesOf(c.src))).toBe(hex(c.bytes));
  });
});
