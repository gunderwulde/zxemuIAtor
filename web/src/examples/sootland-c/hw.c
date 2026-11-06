/* Sootland (versión en C) — acceso al hardware y a la ROM (ver hw.h).
 * Funciones __naked: el compilador no pone prólogo ni epílogo; en la pila quedan el retorno y,
 * debajo, los argumentos (ABI de C en docs/c-abi.md). Las que llaman a la ROM guardan IX, que
 * en C es el puntero de marco.
 */
#include "hw.h"

unsigned char inp(unsigned int port) __naked {
__asm
        pop de          ; retorno
        pop bc          ; puerto
        push bc
        push de
        in l,(c)
        ret
__endasm;
}

void outp(unsigned int port, unsigned char v) __naked {
__asm
        pop de          ; retorno
        pop bc          ; puerto
        pop hl          ; valor (en L)
        push hl
        push bc
        push de
        out (c),l
        ret
__endasm;
}

unsigned char rreg(void) __naked {
__asm
        ld a,r
        ld l,a
        ret
__endasm;
}

void chan_open(unsigned char ch) __naked {
__asm
        pop de
        pop hl
        push hl
        push de
        push ix
        ld a,l
        call 1601h
        pop ix
        ret
__endasm;
}

void rst10(unsigned char c) __naked {
__asm
        pop de
        pop hl
        push hl
        push de
        push ix
        ld a,l
        rst 10h
        pop ix
        ret
__endasm;
}

/* STACK-A pone A en la pila de la calculadora y PRINT-FP lo imprime: así el juego escribe
   cifras con la fuente que haya en CHARS sin tener que convertirlas a texto. */
void print_num(unsigned char n) __naked {
__asm
        pop de
        pop hl
        push hl
        push de
        push ix
        ld a,l
        call 2D28h
        call 2DE3h
        pop ix
        ret
__endasm;
}

void print_str(const char *s, unsigned int n) __naked {
__asm
        pop hl          ; retorno
        pop de          ; texto
        pop bc          ; longitud
        push bc
        push de
        push hl
        push ix
        call 203Ch
        pop ix
        ret
__endasm;
}

/* LD-BYTES vuelve por SA/LD-RET (053Fh), que rehabilita las interrupciones y deja el acarreo
   a 1 si la carga fue bien. */
unsigned char ld_bytes(unsigned int addr, unsigned int n, unsigned char flag) __naked {
__asm
        ld hl,2
        add hl,sp
        ld c,(hl)
        inc hl
        ld b,(hl)       ; BC = addr
        inc hl
        ld e,(hl)
        inc hl
        ld d,(hl)       ; DE = n
        inc hl
        ld a,(hl)       ; flag
        push ix
        push bc
        pop ix          ; IX = addr
        scf
        call 0556h
        pop ix
        ld hl,0
        adc hl,hl       ; HL = acarreo
        ret
__endasm;
}

void jump_ending(void) __naked {
__asm
        jp 0CE72h
__endasm;
}

/* Cada vuelta son 26 T-states (DEC BC 6 + LD A,B 4 + OR C 4 + JR NZ 12). */
void spin(unsigned int n) __naked {
__asm
        pop de
        pop bc
        push bc
        push de
.spin1: dec bc
        ld a,b
        or c
        jr nz,.spin1
        ret
__endasm;
}

void long_pause(void) __naked {
__asm
        ld bc,88B8h
.lp1:   dec bc
        push bc
        ld b,32h
.lp2:   djnz .lp2
        pop bc
        ld a,b
        or c
        jr nz,.lp1
        ret
__endasm;
}

/* El chasquido son 768 bytes enviados bit a bit al altavoz (bit 4 del puerto FEh): un byte a 0
   da un solo pulso, uno a FFh, silencio. En el original eran 11 bytes FFh y 757 a 0 dentro de
   la imagen; aquí no caben (el código en C ocupa casi todo el hueco), así que se generan al
   vuelo: H cuenta los FFh que faltan. Se mezcla con el color del borde actual (BORDCR) para que
   el borde no parpadee. */
void ay_play(const unsigned char *regs) __naked {
__asm
        pop de
        pop hl
        push hl
        push de
        ld b,0Eh
        ld e,0
.ay1:   push bc
        ld bc,0FFFDh
        ld a,e
        out (c),a
        ld a,(hl)
        ld bc,0BFFDh
        out (c),a
        inc hl
        inc e
        pop bc
        djnz .ay1
        ld h,0Bh        ; los 11 primeros bytes de la muestra son FFh
        ld bc,0300h
        ld a,(5C48h)
        sra a
        sra a
        sra a
        and 07h
        ld d,a
.ay2:   ld e,1          ; byte 00h + 1
        ld a,h
        or a
        jr z,.ay4
        dec h
        dec e           ; byte FFh + 1 = 0
.ay4:   dec bc
        push bc
        ld b,08h
.ay3:   ld a,e
        and 10h
        rl e
        or d
        out (0FEh),a
        djnz .ay3
        pop bc
        ld a,c
        or b
        jr nz,.ay2
        xor a
        out (0FEh),a
        ret
__endasm;
}

/* ---- Sprites ----
 * Lo que más pesa del bucle de juego: cada vuelta compone y deshace siete sprites de 2x2 celdas
 * (4 celdas x 8 bytes) sobre la escena en BG_BUFFER (AA00h). En C el bucle por celda es unas 1,9
 * veces más lento que el del original, así que va en ensamblador. Recorren las celdas por
 * columnas, como el original: el gráfico, la máscara y el búfer donde se guarda el fondo van
 * seguidos, 8 bytes por celda. IX recorre el gráfico y los registros alternativos la máscara
 * (HL') y el búfer (BC'), de modo que cada byte del fondo cuesta una sola pasada.
 * struct sprite: gfx(2) mask(2) save(2) col row w h on.
 */
void sprite_draw(void *s) __naked {
__asm
        pop de
        pop hl
        push hl
        push de
        push ix
        call sp_load
        jr nz,.sd_end
        push bc
        push de
        exx
        pop hl          ; HL' = máscara
        pop bc          ; BC' = búfer del fondo
        exx
        ld a,(sp_w)
        ld (sp_wl),a
.sd_col:ld a,(sp_row)
        ld (sp_ry),a
        ld a,(sp_h)
        ld (sp_hl),a
.sd_row:ld a,(sp_cx)
        ld c,a
        ld a,(sp_ry)
        call sp_cell
        ld b,8
.sd_ln: ld a,(hl)       ; fondo
        exx
        ld (bc),a       ; se guarda
        inc bc
        and (hl)        ; se recorta con la máscara
        inc hl
        or (ix+0)       ; y se pone el gráfico
        inc ix
        exx
        ld (hl),a
        inc h           ; siguiente línea de la celda: +256
        djnz .sd_ln
        ld hl,sp_ry
        inc (hl)
        ld hl,sp_hl
        dec (hl)
        jr nz,.sd_row
        ld hl,sp_cx
        inc (hl)
        ld hl,sp_wl
        dec (hl)
        jr nz,.sd_col
.sd_end:pop ix
        ret

; Variables del recorrido (no reentrante: sólo se llama desde draw_frame).
sp_col: db 0
sp_row: db 0
sp_w:   db 0
sp_h:   db 0
sp_cx:  db 0
sp_ry:  db 0
sp_wl:  db 0
sp_hl:  db 0

; HL = dirección en BG_BUFFER de la celda (columna C, fila A): el bitmap sigue el orden de la
; pantalla, así que sus 8 líneas están 256 bytes más allá una de otra.
sp_cell:ld l,a
        and 18h
        add a,0AAh
        ld h,a
        ld a,l
        and 7
        rrca
        rrca
        rrca
        add a,c
        ld l,a
        ret nc
        inc h
        ret

; HL = sprite. Sale con IX = gráfico, DE = máscara, BC = búfer, las medidas en sp_* y Z si está encendido.
sp_load:ld c,(hl)
        inc hl
        ld b,(hl)
        inc hl
        push bc
        pop ix
        ld e,(hl)
        inc hl
        ld d,(hl)
        inc hl
        ld c,(hl)
        inc hl
        ld b,(hl)
        inc hl
        ld a,(hl)
        ld (sp_col),a
        ld (sp_cx),a
        inc hl
        ld a,(hl)
        ld (sp_row),a
        inc hl
        ld a,(hl)
        ld (sp_w),a
        inc hl
        ld a,(hl)
        ld (sp_h),a
        inc hl
        ld a,(hl)
        dec a
        ret
__endasm;
}

void sprite_restore(void *s) __naked {
__asm
        pop de
        pop hl
        push hl
        push de
        push ix
        call sp_load
        jr nz,.sr_end
        ld d,b
        ld e,c          ; DE = búfer del fondo
        ld a,(sp_w)
        ld (sp_wl),a
.sr_col:ld a,(sp_row)
        ld (sp_ry),a
        ld a,(sp_h)
        ld (sp_hl),a
.sr_row:ld a,(sp_cx)
        ld c,a
        ld a,(sp_ry)
        call sp_cell
        ld b,8
.sr_ln: ld a,(de)
        inc de
        ld (hl),a
        inc h
        djnz .sr_ln
        ld hl,sp_ry
        inc (hl)
        ld hl,sp_hl
        dec (hl)
        jr nz,.sr_row
        ld hl,sp_cx
        inc (hl)
        ld hl,sp_wl
        dec (hl)
        jr nz,.sr_col
.sr_end:pop ix
        ret
__endasm;
}
