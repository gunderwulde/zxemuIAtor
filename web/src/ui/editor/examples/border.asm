; Cambio de borde: recorre los 8 colores del borde, medio segundo cada uno, y lo deja
; verde, también para la ROM (BORDCR), antes de volver a BASIC.

BORDCR      equ 23624           ; variable de sistema: color del borde (bits 3-5)
FINAL       equ 4               ; verde (índice GRB: 0 negro … 7 blanco)

            org 8000h

start:      ld c,0              ; color actual
.color:     ld a,c
            out (0feh),a        ; bits 0-2 del puerto FEh: borde; 3 (MIC) y 4 (EAR) a 0
            ld b,25             ; 25 frames = 0,5 s
.wait:      halt                ; espera a la interrupción de 50 Hz
            djnz .wait
            inc c
            ld a,c
            cp 8
            jr nz,.color

            ld a,FINAL
            out (0feh),a
            ; Como BORDER en la ROM (2294h): papel = borde, tinta blanca si el borde es
            ; oscuro (0-3) y negra si es claro (4-7). La ROM repone el borde desde aquí.
            ld a,FINAL*8 + 7*(FINAL < 4)
            ld (BORDCR),a
            ret

            end start
