; zxinput.asm — teclado y joysticks de la librería de C (L1).
; Convención de docs/c-abi.md §3 (ver zxgfx.asm).
;
; Matriz del teclado (docs §6): IN (FEh) con el byte alto con un 0 en el bit de la
; semifila; bits 0-4 = teclas, 0 = pulsada. Semifila r ↔ puerto ~(1<<r)·256 + FEh:
;   0 FEFE CAPS Z X C V   1 FDFE A S D F G   2 FBFE Q W E R T   3 F7FE 1 2 3 4 5
;   4 EFFE 0 9 8 7 6      5 DFFE P O I U Y   6 BFFE ENTER L K J H   7 7FFE SPACE SYM M N B
; Se lee la matriz directamente: no depende de la INT de la ROM ni de LAST_K, así que
; funciona igual con IM 2 o con las interrupciones desactivadas.

; unsigned char key_pressed(unsigned char row, unsigned char bit) → 1 si está pulsada
_key_pressed:
        call __zx_args2         ; C = fila, B = bit
        ld a,c
        and 7
        ld c,a
        ld a,0FEh
        inc c
.r:     dec c
        jr z,.rd
        rlca                    ; FEh rotado fila veces = ~(1 << fila)
        jr .r
.rd:    in a,(0FEh)             ; A es el byte alto del puerto
        ld c,a
        ld a,b
        and 7
        ld b,a
        ld a,c
        inc b
.b:     dec b
        jr z,.bt
        rrca
        jr .b
.bt:    cpl
        and 1
        ld l,a
        ret

; unsigned char in_key(void) → ASCII de la tecla pulsada, 0 si ninguna.
; Busca la primera tecla que no sea CAPS ni SYMBOL (fila 0 a 7, bit 0 a 4). Con SYMBOL,
; el símbolo rojo de la tecla (los que son palabras clave dan su equivalente del modo E
; o 0); con CAPS, mayúsculas, CAPS+0 = 8 (borrar) y CAPS+SPACE (BREAK) = 27.
_in_key:
        ld bc,0FEFEh            ; B = semifila 0, C = puerto
        ld e,0                  ; índice fila·5
.row:   in a,(c)
        cpl
        and 1Fh
        ld d,a
        ld a,e
        or a
        jr nz,.n0
        res 0,d                 ; CAPS SHIFT no cuenta como tecla
.n0:    cp 35
        jr nz,.n7
        res 1,d                 ; SYMBOL SHIFT tampoco
.n7:    ld a,d
        or a
        jr nz,.found
        ld a,e
        add a,5
        ld e,a
        rlc b
        jr c,.row               ; tras la fila 7 el 0 vuelve al bit 0 y sale el acarreo a 0
        ld l,0
        ret
.found: rra                     ; índice += bit de la primera tecla
        jr c,.idx
        inc e
        jr .found
.idx:   ld d,0                  ; DE = índice 0..39
        ld bc,07FFEh
        in a,(c)
        bit 1,a
        ld hl,__zx_keys_sym
        jr z,.tab               ; SYMBOL pulsada
        ld bc,0FEFEh
        in a,(c)
        rra
        ld hl,__zx_keys
        jr c,.tab               ; sin CAPS
        add hl,de
        ld a,(hl)
        cp 'a'
        jr c,.capsx
        sub 20h                 ; minúscula → mayúscula
        ld l,a
        ret
.capsx: ld l,a
        ld h,0
        ld e,2
        ld bc,__zx_keys_caps
.cx:    ld a,(bc)               ; tabla de pares (tecla, código con CAPS)
        cp l
        jr z,.cf
        inc bc
        inc bc
        dec e
        jr nz,.cx
        ret                     ; HL = la propia tecla (dígitos 1-9, ENTER)
.cf:    inc bc
        ld a,(bc)
        ld l,a
        ret
.tab:   add hl,de
        ld l,(hl)
        ret

; Teclas en orden fila·5 + bit (docs §6). 0 = CAPS / SYMBOL.
__zx_keys:
        db 0,'z','x','c','v'
        db 'a','s','d','f','g'
        db 'q','w','e','r','t'
        db '1','2','3','4','5'
        db '0','9','8','7','6'
        db 'p','o','i','u','y'
        db 13,'l','k','j','h'
        db ' ',0,'m','n','b'
; Con SYMBOL SHIFT: los símbolos de un carácter salen de la tabla SYM-CODES de la ROM
; (026Ah, A..Z) y del teclado (SYMBOL + dígito). Donde la ROM tiene una palabra clave
; (STOP, NOT, STEP, TO, THEN, AND, OR) se da el carácter que la misma tecla escribe en
; modo E con SYMBOL (~ | \ { } [ ]); <=, <>, >= y AT no tienen equivalente: 0.
; El 60h de la ROM es la libra (£) en el juego de caracteres del Spectrum.
__zx_keys_sym:
        db 0,':',60h,'?','/'
        db '~','|','\','{','}'
        db 0,0,0,'<','>'
        db '!','@','#','$','%'
        db '_',')','(',27h,'&'
        db 22h,';',0,']','['
        db 13,'=','+','-','^'
        db ' ',0,'.',',','*'
; CAPS + tecla que no es letra: (tecla, código). Los cursores (CAPS+5..8) se leen con
; joy_cursor(); aquí CAPS + dígito da el dígito.
__zx_keys_caps:
        db '0',8, ' ',27

; unsigned char wait_key(void) — espera a que no haya ninguna tecla pulsada (para no
; repetir la anterior) y después a una tecla con código ASCII; la devuelve.
_wait_key:
.up:    xor a                   ; byte alto 0: todas las semifilas a la vez
        in a,(0FEh)
        cpl
        and 1Fh
        jr nz,.up
.down:  call _in_key
        ld a,l
        or a
        jr z,.down
        ret

; Joysticks: todos devuelven el formato Kempston, 000FUDLR:
; JOY_RIGHT 1, JOY_LEFT 2, JOY_DOWN 4, JOY_UP 8, JOY_FIRE 16.

; unsigned char joy_kempston(void) — puerto 1Fh (activo a 1).
; Sin interfaz el puerto lo contesta el bus flotante (docs §8): FFh en el borde o un
; byte de pantalla; un Kempston pone a 0 los bits 5-7, así que si alguno vale 1 se
; considera que no hay joystick y se devuelve 0.
_joy_kempston:
        in a,(1Fh)
        ld l,0
        ld c,a
        and 0E0h
        ret nz
        ld a,c
        and 1Fh
        ld l,a
        ret

; HL = tabla de 5 pares (byte alto del puerto, máscara) en orden FIRE, UP, DOWN, LEFT,
; RIGHT → L = bits pulsados (cada RL deja la primera entrada en el bit 4).
__zx_joytab:
        ld e,0
        ld b,5
.l:     ld a,(hl)
        inc hl
        in a,(0FEh)
        and (hl)
        inc hl
        scf
        jr z,.p                 ; bit a 0: pulsada
        ccf
.p:     rl e
        djnz .l
        ld l,e
        ret

; unsigned char joy_sinclair1(void) — Interface 2 izquierdo: 6 izq, 7 der, 8 abajo, 9 arriba, 0 fuego
_joy_sinclair1:
        ld hl,.t
        jr __zx_joytab
.t:     db 0EFh,01h, 0EFh,02h, 0EFh,04h, 0EFh,10h, 0EFh,08h
; unsigned char joy_sinclair2(void) — Interface 2 derecho: 1 izq, 2 der, 3 abajo, 4 arriba, 5 fuego
_joy_sinclair2:
        ld hl,.t
        jr __zx_joytab
.t:     db 0F7h,10h, 0F7h,08h, 0F7h,04h, 0F7h,01h, 0F7h,02h
; unsigned char joy_cursor(void) — cursores: 5 izq, 6 abajo, 7 arriba, 8 der, 0 fuego
_joy_cursor:
        ld hl,.t
        jr __zx_joytab
.t:     db 0EFh,01h, 0EFh,08h, 0EFh,10h, 0F7h,10h, 0EFh,04h
; unsigned char joy_qaop(void) — Q arriba, A abajo, O izquierda, P derecha, SPACE fuego
_joy_qaop:
        ld hl,.t
        jr __zx_joytab
.t:     db 07Fh,01h, 0FBh,01h, 0FDh,01h, 0DFh,02h, 0DFh,01h
