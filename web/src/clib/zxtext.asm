; zxtext.asm — texto, printf y color de la librería de C (L1).
; Convención de docs/c-abi.md §3 (ver zxgfx.asm). Usa __zx_rowaddr, __zx_attraddr y
; __zx_args2 de zxgfx.asm.
;
; Rejilla de 32×24 celdas propia: no usa RST 10h ni los canales de la ROM, así que no
; depende de CHAN-OPEN ni pisa las dos filas del editor salvo que se escriba en ellas.
; Fuente de la ROM (carácter c en 3C00h + 8·c, CHARS + 100h); códigos 144..164 = UDG
; (variable UDG, 5C7Bh); el resto de códigos < 32 o ≥ 128 se escribe como '?'.
; '\n' (10, C estándar) y 13 = nueva línea. Al pasar de la columna 31 se sigue en la fila
; siguiente; una nueva línea en la fila 23 desplaza la pantalla una fila hacia arriba.
; El salto es perezoso: escribir en (31,23) no desplaza hasta que llega otro carácter.

__ZX_FONT       equ 3C00h
__ZX_UDG        equ 5C7Bh
__ZX_BORDCR     equ 5C48h   ; color del borde × 8 (y tinta de la parte de abajo)

__zx_col:       db 0
__zx_row:       db 0
__zx_attr:      db 38h      ; PAPER 7, INK 0: el color con que arranca la ROM (ATTR_P)

; void at(unsigned char col, unsigned char row) — fuera de rango se recorta a 31 / 23
_at:
        call __zx_args2
        ld a,c
        cp 32
        jr c,.c
        ld a,31
.c:     ld (__zx_col),a
        ld a,b
        cp 24
        jr c,.r
        ld a,23
.r:     ld (__zx_row),a
        ret

; void cls(void) — bitmap a 0, atributos con el color actual, cursor a (0,0)
_cls:
        ld hl,4000h
        ld de,4001h
        ld bc,6143
        ld (hl),0
        ldir
        ld a,(__zx_attr)
        ld hl,5800h
        ld de,5801h
        ld bc,767
        ld (hl),a
        ldir
        xor a
        ld (__zx_col),a
        ld (__zx_row),a
        ret

; int putchar(int c)
_putchar:
        pop de
        pop hl
        push hl
        push de
        push hl
        ld a,l
        call __zx_putc
        pop hl
        ret

; void print(const char *s)
_print:
        pop de
        pop hl
        push hl
        push de
__zx_puts:                      ; HL = cadena
        ld a,(hl)
        or a
        ret z
        push hl
        call __zx_putc
        pop hl
        inc hl
        jr __zx_puts

; A = carácter. Destruye AF, BC, DE, HL.
__zx_putc:
        cp 10
        jr z,__zx_newline
        cp 13
        jr z,__zx_newline
        ld l,a
        ld a,(__zx_col)
        cp 32
        jr c,.fits
        push hl
        call __zx_newline
        pop hl
.fits:  ld a,l
        ld h,0
        cp 32
        jr c,.bad
        cp 128
        jr c,.rom
        sub 144
        jr c,.bad
        cp 21
        jr nc,.bad
        ld l,a                  ; UDG: (UDG) + 8·(c-144)
        add hl,hl
        add hl,hl
        add hl,hl
        ld de,(__ZX_UDG)
        add hl,de
        jr .draw
.bad:   ld l,'?'
.rom:   add hl,hl
        add hl,hl
        add hl,hl
        ld de,__ZX_FONT
        add hl,de
.draw:  ex de,hl                ; DE = glifo
        ld a,(__zx_row)
        call __zx_rowaddr
        ld a,(__zx_col)
        or l
        ld l,a                  ; HL = línea 0 de la celda
        ld b,8
.line:  ld a,(de)
        ld (hl),a
        inc de
        inc h                   ; dentro de una celda, la línea siguiente es H+1 (docs §3)
        djnz .line
        ld a,(__zx_row)
        ld b,a
        ld a,(__zx_col)
        ld c,a
        call __zx_attraddr
        ld a,(__zx_attr)
        ld (hl),a
        inc c
        ld a,c
        ld (__zx_col),a
        ret

__zx_newline:
        xor a
        ld (__zx_col),a
        ld a,(__zx_row)
        inc a
        cp 24
        jr c,.ok
        call __zx_scroll
        ld a,23
.ok:    ld (__zx_row),a
        ret

; Sube las filas 1..23 a 0..22 (bitmap y atributos) y borra la 23 con el color actual.
__zx_scroll:
        ld c,0                  ; fila destino
.row:   ld a,c
        call __zx_rowaddr
        ex de,hl                ; DE = destino
        ld a,c
        inc a
        call __zx_rowaddr       ; HL = origen
        ld b,8
.ln:    push bc
        push de
        push hl
        ld bc,32
        ldir
        pop hl
        pop de
        pop bc
        inc h
        inc d
        djnz .ln
        inc c
        ld a,c
        cp 23
        jr c,.row
        ld hl,5800h+32
        ld de,5800h
        ld bc,23*32
        ldir
        ld a,23
        call __zx_rowaddr
        ld b,8
.clr:   push bc
        push hl
        ld d,h
        ld e,l
        inc de
        ld (hl),0
        ld bc,31
        ldir
        pop hl
        pop bc
        inc h
        djnz .clr
        ld hl,5800h+23*32
        ld de,5800h+23*32+1
        ld a,(__zx_attr)
        ld (hl),a
        ld bc,31
        ldir
        ret

; ---------------------------------------------------------------------------------
; printf(fmt, ...): %d %i %u %x %X %s %c %%, con anchura opcional y relleno con ceros
; ("%5d", "%05u", "%04x"; sin "%-"). Variádica según docs/c-abi.md §3: los argumentos
; siguen a fmt en la pila, de 2 en 2. Devuelve el número de caracteres escritos.
; ---------------------------------------------------------------------------------

__zx_pf_fmt:    dw 0
__zx_pf_ap:     dw 0
__zx_pf_n:      dw 0
__zx_pf_w:      db 0
__zx_pf_pad:    db 0
__zx_pf_sign:   db 0
__zx_pf_hex:    db 0
__zx_pf_buf:    ds 6        ; 5 dígitos como mucho y NUL; %c usa los 2 primeros
__zx_pf_end     equ __zx_pf_buf+5

; int printf(const char *fmt, ...)
_printf:
        ld hl,2
        add hl,sp
        ld e,(hl)
        inc hl
        ld d,(hl)
        inc hl
        ld (__zx_pf_ap),hl
        ld hl,0
        ld (__zx_pf_n),hl
.loop:  ld a,(de)
        inc de
        or a
        jr z,.end
        cp '%'
        jr z,.fmt
        call __zx_pf_out
        jr .loop
.end:   ld hl,(__zx_pf_n)
        ret
.fmt:   xor a
        ld (__zx_pf_w),a
        ld (__zx_pf_sign),a
        ld a,' '
        ld (__zx_pf_pad),a
        ld a,(de)
        cp '0'
        jr nz,.wid
        ld (__zx_pf_pad),a
        inc de
.wid:   ld a,(de)
        sub '0'
        jr c,.conv
        cp 10
        jr nc,.conv
        ld b,a
        ld a,(__zx_pf_w)
        ld c,a
        add a,a
        add a,a
        add a,c
        add a,a                 ; ×10
        add a,b
        ld (__zx_pf_w),a
        inc de
        jr .wid
.conv:  ld a,(de)
        or a
        jr z,.end               ; "%" al final: se ignora
        inc de
        ld (__zx_pf_fmt),de
        cp 'd'
        jr z,.dec
        cp 'i'
        jr z,.dec
        cp 'u'
        jr z,.uns
        ld c,'a'-'9'-1          ; de '9'+1 a 'a'
        cp 'x'
        jr z,.hex
        ld c,'A'-'9'-1
        cp 'X'
        jr z,.hex
        cp 's'
        jr z,.str
        cp 'c'
        jr z,.chr
        call __zx_pf_out        ; '%' u otra letra: se escribe tal cual
        jr .loop
.dec:   call __zx_pf_arg
        bit 7,h
        jr z,.u10
        ld a,'-'
        ld (__zx_pf_sign),a
        xor a
        sub l
        ld l,a
        sbc a,a
        sub h
        ld h,a                  ; -32768 → 8000h, que sin signo es 32768
        jr .u10
.uns:   call __zx_pf_arg
.u10:   ld c,10
        jr .num
.hex:   ld a,c
        ld (__zx_pf_hex),a
        call __zx_pf_arg
        ld c,16
.num:   call __zx_utoa
        jr .emit
.chr:   call __zx_pf_arg
        ld a,l
        ld hl,__zx_pf_buf
        ld (hl),a
        inc hl
        ld (hl),0
        dec hl
        jr .emit
.str:   call __zx_pf_arg
.emit:  ; HL = texto; relleno hasta la anchura contando el signo
        push hl
        ld b,0
.len:   ld a,(hl)
        or a
        jr z,.lend
        inc hl
        inc b
        jr .len
.lend:  ld a,(__zx_pf_sign)
        or a
        jr z,.ns
        inc b
.ns:    ld a,(__zx_pf_w)
        sub b
        jr c,.np
        jr z,.np
        ld b,a                  ; B = caracteres de relleno
        ld a,(__zx_pf_pad)
        cp '0'
        jr nz,.spc
        call __zx_pf_sgn        ; con ceros el signo va delante: -0042
.zl:    ld a,'0'
        call __zx_pf_out
        djnz .zl
        jr .body
.spc:   ld a,' '
        call __zx_pf_out
        djnz .spc
.np:    call __zx_pf_sgn
.body:  pop hl
        call __zx_pf_puts
        ld de,(__zx_pf_fmt)
        jp .loop

__zx_pf_sgn:
        ld a,(__zx_pf_sign)
        or a
        ret z
        xor a
        ld (__zx_pf_sign),a
        ld a,'-'
        ; sigue en __zx_pf_out
; A = carácter → pantalla y cuenta. Conserva BC, DE, HL.
__zx_pf_out:
        push bc
        push de
        push hl
        call __zx_putc
        ld hl,(__zx_pf_n)
        inc hl
        ld (__zx_pf_n),hl
        pop hl
        pop de
        pop bc
        ret

__zx_pf_puts:
        ld a,(hl)
        or a
        ret z
        call __zx_pf_out
        inc hl
        jr __zx_pf_puts

; Siguiente argumento variable → HL. Conserva DE.
__zx_pf_arg:
        ld hl,(__zx_pf_ap)
        ld c,(hl)
        inc hl
        ld b,(hl)
        inc hl
        ld (__zx_pf_ap),hl
        ld h,b
        ld l,c
        ret

; HL = valor sin signo, C = base (10 o 16) → HL = cadena terminada en NUL en el búfer.
__zx_utoa:
        ld de,__zx_pf_end
        xor a
        ld (de),a
.dig:   call __zx_div_hl_c
        add a,'0'
        cp '9'+1
        jr c,.st
        ld b,a
        ld a,(__zx_pf_hex)
        add a,b
.st:    dec de
        ld (de),a
        ld a,h
        or l
        jr nz,.dig
        ex de,hl
        ret

; HL = HL / C, A = HL % C (C ≤ 128). Destruye B. Resta y desplaza, 16 pasos: como el
; resto es < C ≤ 128, al desplazarlo cabe en 8 bits y RLA nunca pierde un bit.
__zx_div_hl_c:
        xor a
        ld b,16
.l:     add hl,hl
        rla
        cp c
        jr c,.n
        sub c
        inc l
.n:     djnz .l
        ret

; ---------------------------------------------------------------------------------
; Color del texto (afecta a los caracteres que se escriban después y a cls)
; ---------------------------------------------------------------------------------

; void ink(unsigned char c) — 0..7
_ink:
        ld hl,2
        add hl,sp
        ld a,(__zx_attr)
        and 0F8h
        ld c,a
        ld a,(hl)
        and 7
        or c
        ld (__zx_attr),a
        ret

; void paper(unsigned char c) — 0..7
_paper:
        ld hl,2
        add hl,sp
        ld a,(hl)
        and 7
        rlca
        rlca
        rlca
        ld c,a
        ld a,(__zx_attr)
        and 0C7h
        or c
        ld (__zx_attr),a
        ret

; void bright(unsigned char on)
_bright:
        ld c,40h
        jr __zx_attrbit
; void flash(unsigned char on)
_flash:
        ld c,80h
__zx_attrbit:
        ld hl,2
        add hl,sp
        ld a,(hl)
        or a
        ld a,(__zx_attr)
        jr z,.off
        or c
        jr .st
.off:   ld b,a
        ld a,c
        cpl
        and b
.st:    ld (__zx_attr),a
        ret

; void set_color(unsigned char a) — atributo completo: FLASH·128 + BRIGHT·64 + PAPER·8 + INK
_set_color:
        ld hl,2
        add hl,sp
        ld a,(hl)
        ld (__zx_attr),a
        ret

; void border(unsigned char c)
; Como BORDER de BASIC (ROM 2294h: OUT (FEh),A / RLCA ×3 / BIT 5,A / JR NZ / XOR 07h /
; LD (BORDCR),A): BORDCR = c·8, con tinta blanca si el borde es oscuro (c < 4), para que
; la ROM mantenga ese borde al volver a BASIC.
_border:
        ld hl,2
        add hl,sp
        ld a,(hl)
        and 7
        out (0FEh),a
        rlca
        rlca
        rlca
        bit 5,a
        jr nz,.light
        xor 7
.light: ld (__ZX_BORDCR),a
        ret
