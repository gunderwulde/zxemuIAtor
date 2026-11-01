; zxsound.asm — beep(hz, ms) de la librería de C (L1).
; Convención de docs/c-abi.md §3 (ver zxgfx.asm).
;
; Rutina propia en vez de BEEPER de la ROM (03B5h): BEEPER usa IX (el marco de C) y
; recibe el periodo ya convertido a su fórmula; aquí la cuenta se hace con T-states
; explícitos y se puede leer en el código. El altavoz es el bit 4 (EAR) de OUT (FEh)
; (docs §6, §12); los bits 0-2 mantienen el borde de BORDCR.
;
; Semiperiodo, con el código fuera de la memoria contendida (≥ 8000h, donde va el
; programa) y la pila también fuera (la de BASIC, bajo FF58h):
;   bucle exterior  ld a,c 4 + xor 10h 7 + ld c,a 4 + out (n),a 11 + push hl 11
;                   + pop hl 10 + dec de 6 + ld a,d 4 + or e 4 + jr nz 12   = 73
;   espera n vueltas de dec hl 6 + ld a,h 4 + or l 4 + jr nz 12 (7 la última) = 26n − 5
;   semiperiodo = 68 + 26n T  →  n = (1 750 000 / hz − 68 + 13) / 26, redondeado (3,5 MHz / 2)
; Resolución 26 T (error ≤ 13 T por semiperiodo): 440 Hz da n = 150, 3968 T, periodo 7936 T
; (ideal 7954,5: −0,23 %); 1000 Hz da n = 65, periodo 3516 T (+0,46 %).
; OUT (FEh) es un puerto de la ULA: dentro de las líneas de pantalla puede retrasarse
; hasta 6 T por contención de E/S (docs §5), menos del 0,2 % a 440 Hz.
; Número de semiperiodos = 2·hz·ms/1000 = hz·ms/500 (como mucho 65535).
; Las interrupciones se desactivan durante el sonido (la INT de la ROM añadiría ~1 ms de
; silencio cada 20 ms) y se reponen como estaban (LD A,I copia IFF2 en P/V).

; void beep(unsigned hz, unsigned ms)
_beep:
        ld hl,2
        add hl,sp
        ld c,(hl)
        inc hl
        ld b,(hl)               ; BC = hz
        inc hl
        ld e,(hl)
        inc hl
        ld d,(hl)               ; DE = ms
        ld a,b
        or c
        ret z
        ld a,d
        or e
        ret z
        ld (__zx_bp_hz),bc
        ld h,b
        ld l,c
        call __zx_mul32         ; DEHL = hz·ms
        ld bc,500
        call __zx_div32         ; DEHL = semiperiodos
        ld a,d
        or e
        jr z,.fit
        ld hl,0FFFFh
.fit:   ld a,h
        or l
        ret z
        ld (__zx_bp_n),hl
        ld de,1Ah               ; 1 750 000 = 1AB3F0h
        ld hl,0B3F0h
        ld bc,(__zx_bp_hz)
        call __zx_div32         ; DEHL = T por semiperiodo
        ld bc,55                ; 68 − 13: redondeo al n más cercano
        or a
        sbc hl,bc
        jr nc,.pos
        ld a,d
        or e
        jr z,.min               ; menos de 55 T: lo más agudo posible
        dec de
.pos:   ld bc,26
        call __zx_div32
        ld a,d
        or e
        jr z,.n16
        ld hl,0FFFFh
.n16:   ld a,h
        or l
        jr nz,.go
.min:   ld hl,1
.go:    ld de,(__zx_bp_n)
        ld a,(5C48h)            ; BORDCR: borde en los bits 3-5
        rrca
        rrca
        rrca
        and 7
        ld c,a
        ld a,i                  ; P/V = IFF2
        push af
        di
.tog:   ld a,c
        xor 10h                 ; EAR
        ld c,a
        out (0FEh),a
        push hl
.wait:  dec hl
        ld a,h
        or l
        jr nz,.wait
        pop hl
        dec de
        ld a,d
        or e
        jr nz,.tog
        pop af
        ret po                  ; estaban desactivadas
        ei
        ret

__zx_bp_hz:     dw 0
__zx_bp_n:      dw 0

; DEHL = HL × DE (sin signo). Destruye AF, BC. Desplaza el producto parcial y el
; multiplicador juntos en DEHL: el bit que sale por arriba de DE decide si se suma BC.
__zx_mul32:
        ld b,h
        ld c,l
        ld hl,0
        ld a,16
.l:     add hl,hl
        rl e
        rl d
        jr nc,.n
        add hl,bc
        jr nc,.n
        inc de
.n:     dec a
        jr nz,.l
        ret

; DEHL = DEHL / BC (sin signo, BC ≠ 0). Destruye AF y B'C'; conserva H'L' (BASIC lo
; necesita) y D'E'. Resto en H'L' durante el cálculo: 17 bits con el acarreo de ADC.
__zx_div32:
        exx
        push hl
        push de
        ld hl,0
        exx
        push bc
        exx
        pop bc                  ; B'C' = divisor
        exx
        ld a,32
.l:     add hl,hl
        rl e
        rl d                    ; acarreo = bit que entra en el resto
        exx
        adc hl,hl
        jr c,.sub               ; el resto ya tiene 17 bits: seguro que ≥ divisor
        or a
        sbc hl,bc
        jr nc,.one
        add hl,bc
        exx
        jr .next
.sub:   or a
        sbc hl,bc
.one:   exx
        inc l                   ; bit del cociente (ADD HL,HL dejó el bit 0 a 0)
.next:  dec a
        jr nz,.l
        exx
        pop de
        pop hl
        exx
        ret
