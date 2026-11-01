; Rayas de borde multicolor sincronizadas con HALT. Cada raya dura exactamente 8 líneas
; (8 × 224 = 1792 T) y el color de salida avanza un paso por frame: las rayas suben.
; (Junto a la zona de pantalla, la contención del puerto FEh puede retrasar un OUT unos T.)
; ESPACIO vuelve a BASIC.

BORDCR      equ 23624           ; variable de sistema: color del borde (bits 3-5)
FLAGS       equ 23611           ; variable de sistema: bit 5 = "hay una tecla nueva"
STRIPES     equ 36              ; 36 × 1792 T caben en el frame junto con la INT

            org 8000h

start:      ld c,0              ; color de la primera raya
frame:      halt                ; la INT marca el principio del frame: mismo punto siempre
            push bc
            ld e,STRIPES
            ; Bucle de 1792 T por vuelta (código en RAM sin contención):
            ; 4+4+7+11+6+7 + (13·133+8) + 4+12 = 1792
stripe:     inc c               ; 4
            ld a,c              ; 4
            and 7               ; 7  sólo borde: sin tocar MIC ni EAR (sin ruido)
            out (0feh),a        ; 11
            inc hl              ; 6  relleno para cuadrar las 1792 T
            ld b,134            ; 7
.wait:      djnz .wait          ; 13·133 + 8
            dec e               ; 4
            jr nz,stripe        ; 12
            pop bc
            inc c               ; el frame siguiente empieza un color después

            ld a,7fh            ; semifila B-N-M-SYMBOL-ESPACIO (puerto 7FFEh)
            in a,(0feh)
            rra                 ; bit 0 = ESPACIO (0 = pulsada)
            jr c,frame

release:    ld a,7fh            ; espera a que se suelte, para que BASIC no la vea
            in a,(0feh)
            rra
            jr nc,release
            ld hl,FLAGS
            res 5,(hl)          ; olvida la pulsación que ya ha registrado la ROM
            ld a,(BORDCR)       ; repone el borde de la ROM
            rrca
            rrca
            rrca
            and 7
            out (0feh),a
            ret

            end start
