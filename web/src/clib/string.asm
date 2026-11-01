; string.asm — memcpy/memset/memcmp/strlen/strcpy/strcmp (L1).
; Convención de docs/c-abi.md §3: argumentos en la pila (sp+2 = 1.º), el llamador
; limpia, retorno en HL. Ninguna rutina toca IX, IY ni el juego alternativo.
; Las copias usan LDIR: 21 T por byte (16 el último), el bucle más corto del Z80
; para mover bloques sin desenrollar.

; void *memcpy(void *dst, const void *src, unsigned n)
_memcpy:
        ld hl,2
        add hl,sp
        ld e,(hl)
        inc hl
        ld d,(hl)               ; DE = dst
        inc hl
        ld a,(hl)
        inc hl
        push af
        ld a,(hl)               ; src alto
        inc hl
        ld c,(hl)
        inc hl
        ld b,(hl)               ; BC = n
        pop hl
        ld l,h
        ld h,a                  ; HL = src
        push de
        ld a,b
        or c
        jr z,.done              ; n = 0: LDIR con BC = 0 copiaría 64 KB
        ldir
.done:  pop hl                  ; devuelve dst
        ret

; void *memset(void *dst, int c, unsigned n)
_memset:
        ld hl,2
        add hl,sp
        ld e,(hl)
        inc hl
        ld d,(hl)               ; DE = dst
        inc hl
        ld a,(hl)               ; c (byte bajo)
        inc hl
        inc hl
        ld c,(hl)
        inc hl
        ld b,(hl)               ; BC = n
        ex de,hl                ; HL = dst
        push hl
        ld e,a
        ld a,b
        or c
        jr z,.done
        ld (hl),e
        dec bc
        ld a,b
        or c
        jr z,.done
        ld d,h
        ld e,l
        inc de
        ldir                    ; cada byte copia al siguiente: relleno con un solo LDIR
.done:  pop hl
        ret

; int memcmp(const void *a, const void *b, unsigned n) → a[i]-b[i] del primer distinto
_memcmp:
        ld hl,2
        add hl,sp
        ld e,(hl)
        inc hl
        ld d,(hl)               ; DE = a
        inc hl
        ld a,(hl)
        inc hl
        push af
        ld a,(hl)
        inc hl
        ld c,(hl)
        inc hl
        ld b,(hl)               ; BC = n
        pop hl
        ld l,h
        ld h,a                  ; HL = b
.loop:  ld a,b
        or c
        jr z,.eq
        ld a,(de)
        sub (hl)
        jr nz,__zx_cmpres
        inc de
        inc hl
        dec bc
        jr .loop
.eq:    ld hl,0
        ret

; A = a[i]-b[i] (≠ 0) y C del SUB → HL = diferencia como int (-255..255).
__zx_cmpres:
        ld l,a
        ld h,0
        ret nc
        dec h                   ; hubo préstamo: a[i] < b[i], resultado negativo
        ret

; unsigned strlen(const char *s)
_strlen:
        pop de
        pop hl
        push hl
        push de
        xor a
        ld b,a
        ld c,a
        cpir                    ; BC termina en -(longitud+1)
        ld a,b
        cpl
        ld h,a
        ld a,c
        cpl
        ld l,a                  ; ~BC = -BC-1 = longitud
        ret

; char *strcpy(char *dst, const char *src)
_strcpy:
        ld hl,2
        add hl,sp
        ld e,(hl)
        inc hl
        ld d,(hl)               ; DE = dst
        inc hl
        ld a,(hl)
        inc hl
        ld h,(hl)
        ld l,a                  ; HL = src
        push de
.loop:  ld a,(hl)
        ld (de),a
        inc hl
        inc de
        or a
        jr nz,.loop
        pop hl
        ret

; int strcmp(const char *a, const char *b)
_strcmp:
        ld hl,2
        add hl,sp
        ld e,(hl)
        inc hl
        ld d,(hl)               ; DE = a
        inc hl
        ld a,(hl)
        inc hl
        ld h,(hl)
        ld l,a                  ; HL = b
.loop:  ld a,(de)
        sub (hl)
        jr nz,__zx_cmpres
        ld a,(de)
        or a
        jr z,.eq                ; iguales hasta el NUL
        inc de
        inc hl
        jr .loop
.eq:    ld h,a
        ld l,a
        ret
