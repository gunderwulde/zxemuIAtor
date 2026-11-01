; zxint.asm — espera de frame e interrupciones IM 2 de la librería de C (L1).
; Convención de docs/c-abi.md §3 (ver zxgfx.asm).

; void wait_frame(void) — espera a la siguiente interrupción de 50 Hz (docs §2: la ULA
; la pide al empezar cada frame). EI por si el programa las había desactivado.
_wait_frame:
        ei
        halt
        ret

; unsigned frames(void) — 16 bits bajos de FRAMES (5C78h), que la INT de la ROM (0038h:
; LD HL,(FRAMES) / INC HL / LD (FRAMES),HL) avanza en cada frame. Con IM 2 de esta
; librería sigue avanzando porque la rutina encadena con la de la ROM.
_frames:
        ld hl,(5C78h)
        ret

; ---------------------------------------------------------------------------------
; IM 2
;
; En IM 2 la CPU salta a la palabra de (I·256 + byte del bus) (docs §2: en el 48K el bus
; vale FFh, pero un periférico o el bus flotante pueden poner otro valor). Para no
; depender del byte se usa una página entera con el mismo valor... que ya existe en la
; ROM: 386Eh–3CFFh está sin usar y lleno de FFh (comprobado en rom/48.rom), así que con
; I = 39h la tabla 3900h–3A00h (257 bytes) da siempre el vector FFFFh. En FFFFh se pone
; un JR (18h) cuyo desplazamiento es el primer byte de la ROM, 0000h = F3h (DI) = −13:
; salta a FFFFh + 2 − 13 = FFF4h, donde va JP __zx_isr. Sólo se ocupan 12 bytes de RAM,
; FFF4h–FFFFh (los 4 últimos del UDG "T" y el UDG "U" con UDG en su sitio por defecto,
; FF58h): se guardan al instalar y se reponen al quitar. I = 39h no está en 40h–7Fh, así
; que no provoca nieve.
;
; __zx_isr guarda AF, BC, DE, HL e IX (la función C conserva IX, pero así vale también
; para rutinas en ensamblador), llama a la función del usuario y termina saltando a la
; INT de la ROM (0038h): ésta guarda lo que usa, avanza FRAMES, lee el teclado (necesita
; IY = 5C3Ah, que la ABI garantiza) y acaba con EI / RET. Así BASIC, LAST_K y frames()
; siguen funcionando con IM 2 activo. La función del usuario corre con las
; interrupciones desactivadas y debe ser corta (menos de un frame, 69 888 T).
; El crt0 ejecuta IM 1 al volver a BASIC (docs/c-abi.md §6); im2_remove lo hace antes.
; ---------------------------------------------------------------------------------

; void im2_install(void *isr) — isr: nombre de una función void f(void)
_im2_install:
        pop de
        pop hl
        push hl
        push de
        di
        ld (__zx_isr_call+1),hl
        ld a,(__zx_im2_on)
        or a
        jr nz,.set
        ld hl,0FFF4h
        ld de,__zx_im2_save
        ld bc,12
        ldir
.set:   ld a,0C3h               ; JP __zx_isr en FFF4h
        ld (0FFF4h),a
        ld hl,__zx_isr
        ld (0FFF5h),hl
        ld a,18h                ; JR en FFFFh; el desplazamiento lo pone la ROM
        ld (0FFFFh),a
        ld a,39h
        ld i,a
        im 2
        ld a,1
        ld (__zx_im2_on),a
        ei
        ret

; void im2_remove(void) — vuelve a IM 1 con I = 3Fh (el valor que pone la ROM al
; arrancar: START/NEW, 11D0h: LD A,3Fh / LD I,A) y repone FFF4h–FFFFh.
_im2_remove:
        ld a,(__zx_im2_on)
        or a
        ret z
        di
        im 1
        ld a,3Fh
        ld i,a
        ld hl,__zx_im2_save
        ld de,0FFF4h
        ld bc,12
        ldir
        xor a
        ld (__zx_im2_on),a
        ei
        ret

__zx_isr:
        push af
        push bc
        push de
        push hl
        push ix
__zx_isr_call:
        call __zx_isr_none      ; parcheado por im2_install
        pop ix
        pop hl
        pop de
        pop bc
        pop af
        jp 0038h
__zx_isr_none:
        ret

__zx_im2_on:    db 0
__zx_im2_save:  ds 12
