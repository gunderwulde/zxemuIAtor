; zxgfx.asm — pantalla, píxeles, líneas y sprites de la librería de C (L1).
;
; Convención de docs/c-abi.md §3: argumentos de 16 bits en la pila de derecha a
; izquierda ((sp+2) = 1.º al entrar), el llamador limpia, retorno en L (8 bits) o HL.
; Todas las rutinas conservan IX (marco de C) e IY (= 5C3Ah, la ROM lo usa en la INT de
; IM 1). Las que usan el juego alternativo (EXX) guardan y reponen H'L', que BASIC
; necesita intacto. Lo interno se llama __zx_* (reservado por la ABI para L1).
;
; Datos de hardware: docs/zx48-hardware.md (§3 memoria y pantalla, §6 puerto FEh,
; §2 interrupción). Rutinas y variables de la ROM: The Complete Spectrum ROM
; Disassembly (Logan & O'Hara); los bytes citados están comprobados en rom/48.rom.

; ---------------------------------------------------------------------------------
; Direcciones de pantalla
; ---------------------------------------------------------------------------------

; B = y (0..191), C = x (0..255) → HL = byte del bitmap. Conserva BC, DE.
; docs §3: addr = 010 Y7 Y6 Y2 Y1 Y0 | Y5 Y4 Y3 X7 X6 X5 X4 X3
__zx_scraddr:
        ld a,b
        and 7
        or 40h
        ld h,a                  ; 0 1 0 0 0 y2 y1 y0
        ld a,b
        rrca
        rrca
        rrca
        and 18h                 ; y7 y6 → bits 4 y 3
        or h
        ld h,a
        ld a,b
        rlca
        rlca
        and 0E0h                ; y5 y4 y3 → bits 7..5
        ld l,a
        ld a,c
        rrca
        rrca
        rrca
        and 1Fh                 ; columna = x / 8
        or l
        ld l,a
        ret

; B = y, C = x → HL = byte, A = máscara del píxel (80h >> (x & 7)). Conserva DE.
__zx_pixaddr:
        call __zx_scraddr
        ld a,c
        and 7
        ld b,a
        ld a,80h
        ret z
.sh:    rrca
        djnz .sh
        ret

; A = fila de caracteres (0..23) → HL = primera línea de píxeles de su celda 0.
__zx_rowaddr:
        ld l,a
        and 18h                 ; tercio de pantalla
        or 40h
        ld h,a
        ld a,l
        and 7
        rrca
        rrca
        rrca                    ; fila dentro del tercio → bits 7..5 de L
        ld l,a
        ret

; B = fila (0..23), C = columna (0..31) → HL = 5800h + 32·fila + columna. Conserva BC, DE.
__zx_attraddr:
        ld a,b
        rrca
        rrca
        rrca
        ld l,a
        and 3
        or 58h
        ld h,a                  ; bits 3-4 de la fila → bits 0-1 de H
        ld a,l
        and 0E0h                ; bits 0-2 de la fila → bits 5-7 de L
        or c
        ld l,a
        ret

; Lee los dos primeros argumentos de 8 bits de una función C de la librería:
; al entrar (sp) = vuelta a la función, (sp+2) = vuelta al llamador C, (sp+4) = 1.º arg.
; → C = 1.º, B = 2.º. Conserva DE.
__zx_args2:
        ld hl,4
        add hl,sp
        ld c,(hl)
        inc hl
        inc hl
        ld b,(hl)
        ret

; unsigned zx_pxaddr(unsigned char x, unsigned char y)
_zx_pxaddr:
        call __zx_args2
        jp __zx_scraddr

; unsigned zx_attraddr(unsigned char col, unsigned char row)
_zx_attraddr:
        call __zx_args2
        jp __zx_attraddr

; unsigned char attr(unsigned char col, unsigned char row)
_attr:
        call __zx_args2
        call __zx_attraddr
        ld l,(hl)
        ret

; void set_attr(unsigned char col, unsigned char row, unsigned char a)
_set_attr:
        call __zx_args2
        inc hl
        inc hl
        ld e,(hl)
        call __zx_attraddr
        ld (hl),e
        ret

; ---------------------------------------------------------------------------------
; Píxeles y líneas. y ≥ 192 cae fuera de la pantalla: no se dibuja (point da 0).
; ---------------------------------------------------------------------------------

; void plot(unsigned char x, unsigned char y)
_plot:
        call __zx_args2
__zx_plot:                      ; B = y, C = x; conserva DE
        ld a,b
        cp 192
        ret nc
        call __zx_pixaddr
        or (hl)
        ld (hl),a
        ret

; void unplot(unsigned char x, unsigned char y)
_unplot:
        call __zx_args2
        ld a,b
        cp 192
        ret nc
        call __zx_pixaddr
        cpl
        and (hl)
        ld (hl),a
        ret

; unsigned char point(unsigned char x, unsigned char y) → 1 si el píxel está a tinta
_point:
        call __zx_args2
        ld l,0
        ld a,b
        cp 192
        ret nc
        call __zx_pixaddr
        and (hl)
        ld l,0
        ret z
        inc l
        ret

; void line(unsigned char x0, unsigned char y0, unsigned char x1, unsigned char y1)
; Bresenham con el error entero de todos los octantes:
;   err = dx - dy; bucle: plot; si (x,y) = (x1,y1) fin; e2 = 2·err;
;   si e2 > -dy { err -= dy; x += sx }   si e2 < dx { err += dx; y += sy }
; dx, dy ≤ 255: err y e2 caben en 16 bits con signo (|e2| ≤ 510).
_line:
        call __zx_args2         ; C = x0, B = y0
        inc hl
        inc hl
        ld e,(hl)               ; x1
        inc hl
        inc hl
        ld d,(hl)               ; y1
        ld (__zx_ln_x1),de      ; x1 y luego y1
        ld a,e
        sub c
        ld e,1
        jr nc,.dxp
        neg
        ld e,0FFh
.dxp:   ld (__zx_ln_dx),a
        ld a,e
        ld (__zx_ln_sx),a
        ld a,d
        sub b
        ld e,1
        jr nc,.dyp
        neg
        ld e,0FFh
.dyp:   ld (__zx_ln_dy),a
        ld a,e
        ld (__zx_ln_sy),a
        ld hl,(__zx_ln_dx)      ; dx (palabra: byte alto 0)
        ld de,(__zx_ln_dy)
        or a
        sbc hl,de
        ld (__zx_ln_err),hl
.loop:  push bc
        call __zx_plot
        pop bc
        ld a,(__zx_ln_x1)
        cp c
        jr nz,.go
        ld a,(__zx_ln_y1)
        cp b
        ret z
.go:    ld hl,(__zx_ln_err)
        add hl,hl               ; e2
        push hl
        ld de,(__zx_ln_dy)
        add hl,de               ; e2 + dy > 0 ⇔ e2 > -dy
        ld a,h
        or a
        jp m,.nox
        or l
        jr z,.nox
        ld hl,(__zx_ln_err)
        or a
        sbc hl,de
        ld (__zx_ln_err),hl
        ld a,(__zx_ln_sx)
        add a,c
        ld c,a
.nox:   pop hl
        ld de,(__zx_ln_dx)
        or a
        sbc hl,de               ; e2 - dx < 0 ⇔ e2 < dx
        jp p,.loop
        ld hl,(__zx_ln_err)
        add hl,de
        ld (__zx_ln_err),hl
        ld a,(__zx_ln_sy)
        add a,b
        ld b,a
        jr .loop

__zx_ln_x1:     db 0
__zx_ln_y1:     db 0
__zx_ln_dx:     dw 0
__zx_ln_dy:     dw 0
__zx_ln_err:    dw 0
__zx_ln_sx:     db 0
__zx_ln_sy:     db 0

; ---------------------------------------------------------------------------------
; Sprites de 8×8 y 16×16 a cualquier (x, y) en píxeles.
; Formato: filas de arriba abajo; 1 byte por fila (8×8) o 2 (16×16, izquierda primero).
; Modos: SPR_XOR (0) pantalla ^= sprite (dibujar dos veces lo borra), SPR_OR (1).
; Con máscara: pantalla = (pantalla AND máscara) OR sprite; máscara a 1 = fondo visible.
; Recorte: las columnas más allá de x = 255 y las filas más allá de y = 191 no se pintan.
; Cada fila se desplaza x & 7 bits a un búfer de w+1 bytes (máscara rellenando con 1)
; y se combina byte a byte; la operación se parchea en el código (XOR E / OR E).
; ---------------------------------------------------------------------------------

; void sprite8(unsigned char x, unsigned char y, const void *gfx, unsigned char mode)
_sprite8:
        ld a,1
        jr __zx_spr_mode
; void sprite16(unsigned char x, unsigned char y, const void *gfx, unsigned char mode)
_sprite16:
        ld a,2
__zx_spr_mode:
        ld (__zx_sp_w),a
        ld hl,8
        add hl,sp
        ld a,(hl)               ; mode
        or a
        ld a,0ABh               ; XOR E
        jr z,.x
        ld a,0B3h               ; OR E
.x:     ld hl,0
        jr __zx_spr_go
; void sprite8_mask(unsigned char x, unsigned char y, const void *gfx, const void *mask)
_sprite8_mask:
        ld a,1
        jr __zx_spr_m
; void sprite16_mask(unsigned char x, unsigned char y, const void *gfx, const void *mask)
_sprite16_mask:
        ld a,2
__zx_spr_m:
        ld (__zx_sp_w),a
        ld hl,8
        add hl,sp
        ld a,(hl)
        inc hl
        ld h,(hl)
        ld l,a                  ; HL = máscara
        ld a,0B3h               ; OR E
__zx_spr_go:
        ld (__zx_sp_mask),hl
        ld (__zx_sp_op0),a
        ld (__zx_sp_op1),a
        ld (__zx_sp_op2),a
        ld hl,6
        add hl,sp
        ld a,(hl)
        inc hl
        ld h,(hl)
        ld l,a
        ld (__zx_sp_gfx),hl
        ld hl,2
        add hl,sp
        ld c,(hl)               ; x
        inc hl
        inc hl
        ld b,(hl)               ; y
        ld a,c
        and 7
        ld (__zx_sp_sh),a
        ld a,c
        rrca
        rrca
        rrca
        and 1Fh
        ld (__zx_sp_col),a
        ld a,(__zx_sp_w)
        add a,a
        add a,a
        add a,a                 ; 8 filas por byte de ancho: 8 o 16
        ld (__zx_sp_cnt),a
__zx_sp_row:
        ld a,b
        cp 192
        ret nc
        push bc
        ; gráfico de la fila → buf0, buf1 (0 si ancho 1), buf2 = 0
        ld hl,(__zx_sp_gfx)
        ld e,(hl)
        inc hl
        ld a,(__zx_sp_w)
        dec a
        ld d,0
        jr z,.g1
        ld d,(hl)
        inc hl
.g1:    ld (__zx_sp_gfx),hl
        ; máscara → m0, m1 (FFh si no hay máscara o ancho 1), m2 = FFh
        ld hl,(__zx_sp_mask)
        ld a,h
        or l
        ld bc,0FFFFh
        jr z,.m1
        ld c,(hl)
        inc hl
        ld a,(__zx_sp_w)
        dec a
        jr z,.m0
        ld b,(hl)
        inc hl
.m0:    ld (__zx_sp_mask),hl
.m1:    ; desplazamiento a la derecha x & 7 bits: E:D:A (gráfico, entra 0),
        ; C:B:H (máscara, entra 1 con SCF: lo que queda fuera del sprite es fondo)
        ld a,(__zx_sp_sh)
        or a
        ld l,a
        ld a,0
        ld h,0FFh
        jr z,.put
.sh:    srl e
        rr d
        rra
        scf
        rr c
        rr b
        rr h
        dec l
        jr nz,.sh
.put:   ld (__zx_sp_g2),a
        ld a,h
        ld (__zx_sp_m2),a
        ld (__zx_sp_g0),de      ; g0 = E, g1 = D
        ld (__zx_sp_m0),bc      ; m0 = C, m1 = B
        pop bc
        push bc
        call __zx_scraddr       ; HL = primer byte de la fila
        ld a,(__zx_sp_col)
        ld c,a
        ; byte 0 (siempre dentro: col ≤ 31)
        ld a,(__zx_sp_g0)
        ld e,a
        ld a,(__zx_sp_m0)
        and (hl)
__zx_sp_op0:
        xor e
        ld (hl),a
        ld a,c
        cp 31
        jr nc,__zx_sp_next
        inc l                   ; misma línea: L no pasa de la columna 31
        ld a,(__zx_sp_g1)
        ld e,a
        ld a,(__zx_sp_m1)
        and (hl)
__zx_sp_op1:
        xor e
        ld (hl),a
        ld a,(__zx_sp_w)
        dec a
        jr z,__zx_sp_next
        ld a,c
        cp 30
        jr nc,__zx_sp_next
        inc l
        ld a,(__zx_sp_g2)
        ld e,a
        ld a,(__zx_sp_m2)
        and (hl)
__zx_sp_op2:
        xor e
        ld (hl),a
__zx_sp_next:
        pop bc
        inc b
        ld hl,__zx_sp_cnt
        dec (hl)
        jp nz,__zx_sp_row
        ret

__zx_sp_w:      db 0
__zx_sp_sh:     db 0
__zx_sp_col:    db 0
__zx_sp_cnt:    db 0
__zx_sp_gfx:    dw 0
__zx_sp_mask:   dw 0
__zx_sp_g0:     db 0
__zx_sp_g1:     db 0
__zx_sp_g2:     db 0
__zx_sp_m0:     db 0
__zx_sp_m1:     db 0
__zx_sp_m2:     db 0
