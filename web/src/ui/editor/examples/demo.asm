; Arco iris: bandas diagonales de color que se desplazan por la pantalla y rayas en
; el borde, sincronizadas con la interrupción de 50 Hz (HALT).
; Pulsa Ctrl+Enter para ejecutarlo y ESPACIO para volver a BASIC.

ATTRS       equ 5800h           ; atributos: 32 por fila, bits 3-5 = PAPER, bit 6 = BRIGHT
ROWS        equ 22              ; filas 0-21 (las dos de abajo son del editor de BASIC)
ATTR_P      equ 23693           ; variable de sistema: colores permanentes de la pantalla
BORDCR      equ 23624           ; variable de sistema: color del borde (bits 3-5)
FLAGS       equ 23611           ; variable de sistema: bit 5 = "hay una tecla nueva"

            org 8000h

start:      ld e,0              ; fase de la animación: avanza un color por frame
frame:      halt                ; espera a la INT: empezamos siempre en el mismo punto
            ld hl,ATTRS
            ld d,ROWS
            ld c,e              ; color de la primera banda de la fila
row:        ld a,c
            and 7               ; sólo bits 0-2: borde (bit 3 MIC y 4 EAR a 0, sin ruido)
            out (0feh),a        ; una raya de borde por cada fila que pintamos
            ld b,8              ; 8 bandas de 4 celdas = 32 columnas
band:       ld a,c
            and 7
            rlca
            rlca
            rlca                ; color al PAPER: el bitmap está vacío, se ve el papel
            or 40h              ; BRIGHT
            ld (hl),a
            inc hl
            ld (hl),a
            inc hl
            ld (hl),a
            inc hl
            ld (hl),a
            inc hl
            inc c               ; la banda siguiente, un color más allá
            djnz band
            ld a,c
            sub 7               ; c-8+1: cada fila empieza un color después → diagonal
            ld c,a
            dec d
            jr nz,row

            ld d,40             ; resto del frame: más rayas de borde (~3,7 líneas cada una)
stripes:    ld a,c
            and 7
            out (0feh),a
            inc c
            ld b,60             ; espera 13·59+8 T
.wait:      djnz .wait
            dec d
            jr nz,stripes

            dec e               ; el frame siguiente, desplazado: las bandas se mueven
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

            ld a,(ATTR_P)       ; deja la pantalla como estaba: atributos permanentes
            ld hl,ATTRS
            ld (hl),a
            ld de,ATTRS+1
            ld bc,ROWS*32-1
            ldir
            ld a,(BORDCR)       ; y el borde que espera la ROM
            rrca
            rrca
            rrca
            and 7
            out (0feh),a
            ret                 ; vuelve a BASIC

            end start
