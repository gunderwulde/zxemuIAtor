; Hola mundo para ZX Spectrum 48K.
; Imprime un texto con RST 10h, pone el borde azul y vuelve a BASIC con RET.

CHAN_OPEN   equ 1601h           ; ROM: abre el canal cuyo número va en A
BORDCR      equ 23624           ; variable de sistema: color del borde (bits 3-5)
BORDER_COL  equ 1               ; azul

            org 8000h

start:      ld a,2              ; canal 2 = parte superior de la pantalla
            call CHAN_OPEN
            ld hl,message
.next:      ld a,(hl)
            or a
            jr z,.done
            push hl
            rst 10h             ; imprime el carácter de A en el canal actual
            pop hl
            inc hl
            jr .next

.done:      ld a,BORDER_COL
            out (0feh),a        ; el borde son los bits 0-2 del puerto FEh
            ld a,BORDER_COL*8+7 ; la ROM restaura el borde desde BORDCR (p. ej. al
            ld (BORDCR),a       ; hacer clic una tecla): papel azul, tinta blanca
            ret                 ; vuelve a BASIC

message:    db 22,10,9          ; AT 10,9
            db 16,2             ; INK 2 (rojo)
            db "Hola, mundo!"
            db 16,8             ; INK 8 (transparente: la del canal)
            db 0

            end start
