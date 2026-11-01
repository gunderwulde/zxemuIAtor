; stdlib.asm — rand/srand/abs (L1). exit() lo define el crt0 (docs/c-abi.md §6).
; Convención de docs/c-abi.md §3.

; int rand(void) → 0..32767 (RAND_MAX)
; Xorshift de 16 bits con la terna (7,9,8): x ^= x<<7; x ^= x>>9; x ^= x<<8.
; Periodo 65535 (todo valor salvo 0). Implementación de John Metcalf ("16-bit xorshift
; pseudorandom numbers in Z80 assembly", 2015): cada RRA hace en un solo paso el
; desplazamiento de 7/9 bits entre bytes, por eso no hay bucles. Se devuelven los 15
; bits bajos para que el resultado sea un int no negativo, como pide C.
_rand:
        ld hl,(__zx_seed)
        ld a,h
        rra
        ld a,l
        rra
        xor h
        ld h,a
        ld a,l
        rra
        ld a,h
        rra
        xor l
        ld l,a
        xor h
        ld h,a
        ld (__zx_seed),hl
        res 7,h
        ret

; void srand(unsigned seed) — 0 dejaría el generador parado en 0: se usa 1.
_srand:
        pop de
        pop hl
        push hl
        push de
        ld a,h
        or l
        jr nz,.ok
        inc l
.ok:    ld (__zx_seed),hl
        ret

__zx_seed:
        dw 1

; int abs(int n)
_abs:
        pop de
        pop hl
        push hl
        push de
        bit 7,h
        ret z
        xor a
        sub l
        ld l,a
        sbc a,a
        sub h
        ld h,a
        ret
