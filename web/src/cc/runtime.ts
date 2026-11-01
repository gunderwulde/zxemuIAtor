// Runtime de C (K1): helpers de multiplicación, división, módulo y desplazamientos, y
// crt0. Convención de los helpers (docs/c-abi.md §4): HL = izquierdo, DE = derecho,
// resultado en HL; destruyen AF, BC, DE; conservan IX, IY y el juego alternativo.

export const HELPERS: Record<string, { deps: string[]; code: string }> = {
  __mul16: {
    deps: [],
    // Desplaza el multiplicador (DE) por la izquierda y suma el multiplicando (BC) por
    // cada bit a 1. Si D = 0 bastan 8 vueltas (el byte alto no aporta nada).
    code: `
__mul16:
        ld b,h
        ld c,l
        ld hl,0
        ld a,d
        or a
        ld a,16
        jr nz,.m1
        ld d,e
        ld e,h
        ld a,8
.m1:    add hl,hl
        sla e
        rl d
        jr nc,.m2
        add hl,bc
.m2:    dec a
        jr nz,.m1
        ret`,
  },
  __divu16: {
    deps: [],
    // División con restauración, 16 vueltas. Sale con HL = cociente y DE = resto.
    // Si el resto parcial desborda 16 bits al doblarlo (divisor > 8000h) es seguro que
    // supera al divisor: se resta sin comparar.
    code: `
__divu16:
        ld a,d
        or e
        jr z,.dz
        ld b,h
        ld c,l
        ld hl,0
        ld a,16
.d1:    sla c
        rl b
        adc hl,hl
        jr c,.ov
        sbc hl,de
        jr nc,.set
        add hl,de
        jr .nx
.ov:    or a
        sbc hl,de
.set:   inc c
.nx:    dec a
        jr nz,.d1
        ex de,hl
        ld h,b
        ld l,c
        ret
.dz:    ex de,hl
        ld hl,0FFFFh
        ret`,
  },
  __modu16: {
    deps: ["__divu16"],
    code: `
__modu16:
        call __divu16
        ex de,hl
        ret`,
  },
  __neghl: {
    deps: [],
    code: `
__neghl:
        xor a
        sub l
        ld l,a
        sbc a,a
        sub h
        ld h,a
        ret`,
  },
  __abs2: {
    deps: ["__neghl"],
    code: `
__abs2:
        bit 7,h
        call nz,__neghl
        bit 7,d
        ret z
        ex de,hl
        call __neghl
        ex de,hl
        ret`,
  },
  __divs16: {
    deps: ["__abs2", "__divu16", "__neghl"],
    // C99 6.5.5: el cociente trunca hacia cero; signo = signo(a) xor signo(b).
    code: `
__divs16:
        ld a,h
        xor d
        push af
        call __abs2
        call __divu16
        pop af
        ret p
        jp __neghl`,
  },
  __mods16: {
    deps: ["__abs2", "__divu16", "__neghl"],
    // C99 6.5.5: (a/b)*b + a%b == a, así que el resto lleva el signo del dividendo.
    code: `
__mods16:
        ld a,h
        or a
        push af
        call __abs2
        call __divu16
        ex de,hl
        pop af
        ret p
        jp __neghl`,
  },
  __shl16: {
    deps: [],
    code: `
__shl16:
        ld a,d
        or a
        jr nz,.z
        ld a,e
        cp 16
        jr nc,.z
        or a
        ret z
        ld b,a
.l:     add hl,hl
        djnz .l
        ret
.z:     ld hl,0
        ret`,
  },
  __shru16: {
    deps: [],
    code: `
__shru16:
        ld a,d
        or a
        jr nz,.z
        ld a,e
        cp 16
        jr nc,.z
        or a
        ret z
        ld b,a
.l:     srl h
        rr l
        djnz .l
        ret
.z:     ld hl,0
        ret`,
  },
  __shrs16: {
    deps: [],
    code: `
__shrs16:
        ld a,d
        or a
        jr nz,.z
        ld a,e
        cp 16
        jr nc,.z
        or a
        ret z
        ld b,a
.l:     sra h
        rr l
        djnz .l
        ret
.z:     ld a,h
        rla
        sbc a,a
        ld h,a
        ld l,a
        ret`,
  },
};

/** Cierra `used` con las dependencias y devuelve el código en orden estable. */
export function helperCode(used: Set<string>): string {
  const all = new Set<string>();
  const add = (n: string) => {
    if (all.has(n)) return;
    all.add(n);
    for (const d of HELPERS[n]!.deps) add(d);
  };
  for (const n of used) add(n);
  return Object.keys(HELPERS).filter((n) => all.has(n)).map((n) => HELPERS[n]!.code).join("\n");
}

/** crt0 (docs/c-abi.md §6). bssSize en bytes. */
export function crt0(bssSize: number): string {
  const bss = bssSize === 0 ? "" : bssSize === 1 ? `
        xor a
        ld (__bss_start),a` : `
        ld hl,__bss_start
        ld de,__bss_start+1
        ld bc,${bssSize - 1}
        ld (hl),0
        ldir`;
  return `
__start:
        exx
        push hl                 ; H'L' de BASIC: hay que devolverlo intacto
        exx
        ld (__crt_sp),sp${bss}
        call _main
__crt_exit:                     ; HL = código de salida
        ld sp,(__crt_sp)
        exx
        pop hl
        exx
        im 1                    ; por si quedó IM 2 puesto (BASIC va siempre en IM 1)
        ld b,h                  ; USR devuelve BC a BASIC
        ld c,l
        ret
_exit:
        pop de
        pop hl
        jr __crt_exit
__crt_sp:
        dw 0`;
}
