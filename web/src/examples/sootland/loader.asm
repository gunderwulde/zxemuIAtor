; Sootland — loader.bin
; Bloque A de la cinta (CODE en AFC8h): música, menú de la intro y cargador del motor.
; © 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso.
; Gráficos: Alberto Herraiz y Fernando Pérez. Música: J. Torres.
; Reconstruido por ingeniería inversa de la cinta original e incluido con permiso de su autor.

; Dónde está grabado el stub (se ejecuta reubicado en AFC8h, ver PHASE más abajo).
stub_loader   equ 0F0F2h
rom_start      equ 00000h
rom_key_scan   equ 0028Eh
rom_ld_bytes   equ 00556h
rom_chan_open  equ 01601h
rom_print_str  equ 0203Ch
ERR_NR_mark    equ 05C37h
FLAGS          equ 05C3Bh
ERR_SP         equ 05C3Dh

 org 0AFC8h
; SOOTLAND — loader.bin (bloque A, cara 1): música, menú de la intro y cargador del motor.
; © 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso. Gráficos: Alberto Herraiz y
; Fernando Pérez. Música: J. Torres. Incluido con permiso de su autor.
; 
; Toca la música hasta que se pulsa una tecla (el reproductor, music_tick, es la rutina de B00Fh).
music_run:  ld   hl,dat_B0D1
            ld   (dat_AFE3),hl
            ld   hl,lbl_B14A
            ld   (dat_AFE7),hl
            di
lbl_AFD5:   call music_tick
            call rom_key_scan
            inc  e
            jr   z,lbl_AFD5
            ei
            ret
dat_AFE0:
 db 00h
dat_AFE1:
 db 00h
dat_AFE2:
 db 00h
dat_AFE3:
 db 60h,0EAh,0D2h,0B0h
dat_AFE7:
 db 48h,0EEh,4Bh,0B1h
dat_AFEB:
 db 0EEh
sub_AFEC:   ld   e,(hl)
            inc  hl
            ld   d,(hl)
            inc  de
lbl_AFF0:   ld   a,(de)
            cp   40h
            jr   z,lbl_B007
            ld   (hl),d
            dec  hl
            ld   (hl),e
            ret
sub_AFF9:   ld   a,(hl)
            add  a,0Ch
            ld   e,a
            ld   d,00h
            ld   hl,dat_B09C
            add  hl,de
            ld   h,(hl)
            ld   l,01h
            ret
lbl_B007:   inc  hl
            ld   e,(hl)
            inc  hl
            ld   d,(hl)
            dec  hl
            dec  hl
            jr   lbl_AFF0
music_tick: ld   hl,dat_AFE3
            call sub_AFEC
            ld   (dat_AFE0),a
            ld   hl,dat_AFE7
            call sub_AFEC
            ld   (dat_AFE1),a
            ld   hl,dat_AFE0
            call sub_AFF9
            rl   e
            jp   c,lbl_B0D2
            push hl
            ld   hl,dat_AFE1
            call sub_AFF9
            pop  de
            ld   a,h
            dec  a
            jr   nz,lbl_B03C
            ld   a,d
            dec  a
            jr   z,lbl_B07E
lbl_B03C:   ld   a,(dat_AFEB)
            ld   c,a
            ld   b,00h
            ld   a,(dat_AFE2)
            ex   af,af'
            ld   a,(dat_AFE2)
            ld   ixh,d
            ld   d,10h
lbl_B04D:   nop
            nop
lbl_B04F:   ex   af,af'
            dec  e
            out  (0FEh),a
            jr   nz,lbl_B06C
            ld   e,ixh
            xor  d
            ex   af,af'
            dec  l
            jp   nz,lbl_B073
lbl_B05D:   out  (0FEh),a
            ld   l,h
            xor  d
            djnz lbl_B04D
            inc  c
            jp   nz,lbl_B04F
            ret
 db 61h,64h,61h,6Dh
lbl_B06C:   jr   z,lbl_B06C
            ex   af,af'
            dec  l
            jp   z,lbl_B05D
lbl_B073:   out  (0FEh),a
            nop
            nop
            djnz lbl_B04D
            inc  c
            jp   nz,lbl_B04F
            ret
lbl_B07E:   ld   a,(dat_AFEB)
            cpl
            ld   c,a
            push bc
            push af
            ld   b,00h
lbl_B087:   push hl
            ld   hl,rom_start
            sra  (hl)
            sra  (hl)
            sra  (hl)
            nop
            pop  hl
            djnz lbl_B087
            dec  c
            jp   nz,lbl_B087
            pop  af
            pop  bc
            ret
dat_B09C:
 db 0FFh,0F0h,0E3h,0D7h,0CBh,0C0h,0B4h,0ABh,0A1h,97h,90h,88h,80h,79h,72h,6Ch
 db 66h,60h,5Bh,56h,51h,4Ch,48h,44h,40h,3Dh,39h,36h,33h,30h,2Dh,2Bh
 db 28h,26h,24h,22h,20h,1Eh,1Ch,1Bh,19h,18h,17h,15h,14h,13h,12h,11h
 db 10h,0Fh,0Eh,0Dh,0Ch
dat_B0D1:
 db 01h
lbl_B0D2:   inc  c
            inc  de
            dec  d
            inc  de
            dec  d
            inc  de
            ld   c,13h
            dec  d
            inc  de
            dec  d
            inc  de
            inc  c
            inc  de
            dec  d
            inc  de
            dec  d
            inc  de
            ld   c,13h
            dec  d
            inc  de
            dec  d
            inc  de
            inc  c
            inc  de
            dec  d
            inc  de
            dec  d
            inc  de
            ld   c,13h
            dec  d
            inc  de
            dec  d
            inc  de
            inc  c
            inc  de
            dec  d
            inc  de
            dec  d
            inc  de
            ld   c,13h
            dec  d
            inc  de
            dec  d
            inc  de
            inc  c
            inc  de
            dec  d
            inc  de
            dec  d
            inc  de
            ld   c,13h
            dec  d
            inc  de
            ld   (de),a
            ld   c,13h
            dec  d
            inc  de
            rla
            inc  de
            ld   c,13h
            dec  d
            inc  de
            rla
            inc  de
            inc  c
            inc  de
            dec  d
            inc  de
            dec  d
            inc  de
            inc  c
            inc  de
            dec  d
            inc  de
            dec  d
            inc  de
            inc  c
            ld   de,1115h
            dec  d
            ld   de,110Ch
            inc  de
            ld   de,1113h
            inc  c
            djnz lbl_B147
            djnz lbl_B149
            djnz lbl_B146
            inc  de
            dec  d
            inc  de
            dec  d
            inc  de
            inc  c
            inc  de
            dec  d
            inc  de
            dec  d
            inc  de
            ld   c,13h
            dec  d
lbl_B146:   inc  de
lbl_B147:   dec  d
            inc  de
lbl_B149:   ld   b,b
lbl_B14A:   ld   hl,2929h
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            add  hl,hl
            jr   lbl_B17D
 db 29h,29h,29h,29h,1Fh,1Fh,29h,29h,21h,21h,1Fh,1Fh,29h,29h,29h,29h
 db 1Ah,1Ah,29h,29h,29h,29h,18h,18h
lbl_B17D:   rra
            rra
            rra
            rra
            rra
            rra
            add  hl,hl
            add  hl,hl
            ld   hl,1F21h
            rra
            rra
            rra
            rra
            rra
            rra
            rra
            add  hl,hl
            add  hl,hl
            add  hl,hl
            jr   lbl_B1AC
 db 1Fh,1Fh,21h,1Fh,23h,23h,24h,24h,23h,23h,18h,18h,1Ah,1Ah,18h,18h
 db 1Bh,1Bh,18h,18h,1Ah,18h,1Dh,1Dh
lbl_B1AC:   rra
            rra
            rra
            rra
            rra
            rra
            jr   lbl_B1CC
 db 1Ah,1Ah,18h,18h,29h,29h,29h,29h,29h,29h,29h,29h,29h,29h,40h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h
lbl_B1CC:   nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
swap_ending:ld   hl,intro
            ld   de,61A8h
            ld   bc,13A1h
            ldir
            ld   hl,dat_C350
            ld   de,intro
            ld   bc,13A1h
            ldir
            call intro
            ld   hl,61A8h
            ld   de,intro
            ld   bc,13A1h
            ldir
            ret
 ds 163
gfx_title1:
 db 00h,00h,01h,0Ah,15h,0Ah,15h,0Bh,15h,2Bh,17h,2Bh,17h,2Fh,17h,2Fh
 db 17h,2Fh,17h,2Fh,1Fh,2Fh,1Fh,2Fh,15h,2Ah,15h,2Ah,15h,2Ah,15h,2Ah
 db 15h,2Ah,15h,0Ah,15h,0Ah,17h,0Fh,0Fh,0Fh,0Fh,2Fh,27h,27h,37h,3Fh
 ds 23,3Fh
 db 3Eh,3Dh,3Eh,14h,0Ah,14h,20h,11h,20h,11h,2Ah,35h,33h,37h,33h,37h
 db 3Bh,37h,3Bh,37h,3Bh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh
 db 3Eh,3Dh,3Ah,35h,3Eh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,1Fh,1Fh
 db 1Fh,1Fh,1Fh,1Fh,1Fh,0Fh,0Fh,07h,03h,07h,0Fh,0Fh,0Fh,1Fh,1Fh,1Fh
 db 1Fh,1Fh,1Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh
 db 3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Eh,3Fh,3Eh,3Fh,3Eh,3Fh,3Eh,3Fh,3Eh,3Dh
 db 3Eh,3Dh,3Eh,3Dh,3Ah,3Dh,3Ah,3Dh,3Ah,00h,00h,55h,0A0h,51h,0A2h,55h
 db 83h,0C5h,0A2h,0D1h,0EAh,0D1h,0E2h,0D0h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0D4h
 db 0A8h,54h,0A8h,54h,0A8h,54h,0A8h,54h,0A8h,54h,0A8h,54h,0A8h,54h,0A8h,0D4h
 db 0E8h,0D4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h
 db 0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h
 db 0E8h,74h,68h,0F4h,0E8h,74h,0E8h,74h,0E8h,74h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h
 db 0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0D4h,0A8h,0D4h,0A0h,54h
 db 0A0h,40h,80h,44h,0A0h,54h,0A0h,0D4h,0A8h,0D4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h
 db 0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F0h,0E0h,0F0h,0E0h,0F0h,0E0h,0F0h
 db 0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0D4h,0A8h,0D4h,0A8h,0D4h,0A8h,0D4h,0A0h,54h
 db 0A0h,54h,0A0h,44h,0A0h,44h,0A0h,44h,0A0h,44h,0A0h,44h,0A0h,44h,0A0h,44h
 db 0A0h,44h,0A0h,44h,0A0h,44h,0A0h,44h,80h
gfx_title2:
 db 00h,00h,55h,00h,00h,0A8h,54h,0FAh,0F4h,0EAh,0F9h,0F4h,0FDh,0FFh,3Fh,3Fh
 db 3Fh,1Fh,2Fh,17h,2Fh,17h,2Bh,07h,2Bh,07h,23h,05h,23h,05h,23h,15h
 db 23h,11h,2Bh,31h,2Ah,11h,20h,14h,22h,05h,2Ah,05h,0Ah,15h,2Ah,15h
 db 3Ah,3Dh,3Ah,3Dh,3Ah,35h,3Ah,3Dh,3Ah,35h,3Bh,35h,3Ah,3Dh,3Eh,3Dh
 db 3Eh,3Dh,3Eh,3Fh,3Eh,3Fh,3Fh,3Fh,3Fh,3Fh,3Eh,3Fh,3Eh,3Eh,3Fh,3Fh
 ds 22,3Fh
 db 1Fh,2Fh,17h,0Bh,07h,0Fh,07h,0Fh,07h,0Eh,15h,2Ah,15h,2Ah,15h,2Ah
 db 35h,2Ah,35h,3Ah,35h,3Ah,3Dh,3Ah,3Dh,3Ah,0Dh,2Ah,2Dh,2Eh,2Dh,2Eh
 db 2Fh,0Bh,3Ch,3Ch,3Ch,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh
 ds 25,3Fh
 db 3Eh,00h,00h,50h,08h,04h,00h,04h,00h,04h,80h,44h,80h,44h,0A0h,44h
 db 0A0h,54h,0A8h,0D4h,0A8h,0D4h,0E8h,0D4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h
 db 0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,68h,0B4h,68h,34h,28h,94h,48h,0A4h,48h,0F4h
 db 0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,68h,0F4h,0E8h,0F4h,68h,0F4h,68h,0F4h
 db 68h,0D4h,68h,0D4h,68h,0D0h,0A0h,0D0h,0A0h,44h,88h,54h,28h,14h,0A8h,54h
 db 0A8h,0D4h,0A8h,0D4h,0E8h,0D4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h
 db 0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0D4h,0E8h,0D4h,0A8h,0D4h,0A8h,0D4h
 db 0A8h,54h,0A8h,54h,0A8h,54h,0A8h,54h,0A8h,54h,0A8h,74h,0E8h,74h,0E8h,74h
 db 0E8h,74h,0E8h,74h,0E8h,0F4h,0E8h,0F4h,0E8h,74h,68h,0F4h,0E8h,0F4h,0E8h,0F4h
 db 0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h,0E8h,0F4h
 db 0E8h,0F4h,0E8h,0D4h,0E8h,0D4h,0E8h,0D4h,0E0h,0D4h,0A0h,0C4h,0A0h,44h,80h,44h
 db 80h
gfx_title3:
 db 00h,00h,55h,0AAh,55h,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,00h,00h
 db 00h,00h,55h,0AAh,55h,0FFh,0FFh,0FFh,0EFh,0F7h,0F8h,0E7h,0FFh,0FFh,00h,00h
 db 00h,00h,55h,0AAh,55h,0FFh,0FFh,0FFh,0FFh,0FFh,0Fh,0F0h,0FFh,0FFh,00h,00h
 db 00h,00h,55h,0AAh,55h,0FFh,0FFh,0FFh,0FFh,0FCh,0E3h,0Fh,80h,0F8h,00h,00h
 db 00h,00h,55h,0AAh,55h,0FFh,0F7h,0E7h,0CFh,3Fh,0FFh,0FFh,7Fh,07h,00h,00h
 db 00h,00h,55h,0AAh,55h,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,00h,00h
 db 00h,00h,55h,0AAh,55h,0FEh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FAh,00h,00h
 db 00h,00h,55h,0AAh,55h,0AAh,55h,0EAh,0F5h,0FEh,0F5h,0EAh,55h,0AAh,00h,00h
 db 00h,00h,55h,0AAh,55h,0AAh,55h,0AFh,5Fh,0FFh,5Fh,0BFh,57h,0AAh,00h,00h
 db 00h,00h,55h,0AAh,55h,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,00h,00h
 db 00h,00h,55h,0A8h,55h,0FAh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,00h,00h
gfx_title4:
 db 6Ah,55h,2Ah,7Fh,7Fh,7Fh,7Fh,7Fh,0FFh,5Fh,5Fh,5Fh,5Fh,5Fh,5Fh,0FFh
 db 7Fh,7Fh,7Fh,7Fh,7Ch,7Eh,7Fh,7Fh,7Fh,7Fh,7Fh,7Fh,7Ch,7Eh,7Fh,7Fh
 db 0FFh,5Fh,5Fh,5Fh,5Ch,5Eh,5Fh,0FFh,7Fh,7Fh,7Fh,7Fh,7Fh,7Fh,7Fh,7Fh
 db 0A0h,50h,0A0h,0D0h,0A0h,0D0h,0A0h,0D0h,0E8h,0D0h,0E8h,0F4h,0EAh,0F5h,0FAh,0FDh
 db 0FEh,0FFh,0FFh,0FFh,00h,0FFh,00h,0FFh,0FFh,0FFh,0FFh,0FFh,00h,0FFh,00h,0FFh
 db 0FFh,0FFh,0FFh,0FFh,00h,0FFh,00h,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh
 db 00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 0A0h,55h,0AAh,0F5h,0FFh,0FFh,00h,0FFh,00h,0FFh,0FFh,0FFh,0FFh,0FFh,00h,0FFh
 db 00h,0FFh,0FFh,0FFh,0FFh,0FFh,00h,0FFh,00h,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh
 db 0FFh,0FFh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,0AAh,55h,0FFh,0FFh,00h,0FFh,00h,0FFh,0FFh,0FFh,0FFh,0FFh,00h,0FFh
 db 00h,0FFh,0FFh,0FFh,0FFh,0FFh,00h,0FFh,00h,0FFh,0FFh,0FFh,0FFh,0FFh,0DFh,0CFh
 db 0C7h,81h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,0AAh,55h,0FFh,0FFh,3Fh,0DFh,0Fh,0FFh,0FFh,0FFh,0FFh,0FFh,3Fh,0DFh
 db 0Fh,0FFh,0FFh,0FFh,0FFh,0FFh,3Fh,0DFh,0Fh,0FEh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh
 db 0FFh,0FFh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,0A2h,45h,0A3h,0C7h,0A7h,0C7h,0A7h,0C7h,0A7h,0C7h,0A7h,0C7h,0A7h,0C7h
 db 0A7h,0C7h,87h,87h,87h,0A7h,07h,27h,47h,0A7h,0C7h,0A7h,0C7h,0A7h,0C7h,0A7h
 db 0C7h,0E7h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,0AAh,55h,0FFh,0FFh,0E0h,0DFh,80h,0FFh,0FFh,0FFh,0FFh,0FFh,0E0h,0DFh
 db 80h,0FFh,0FFh,0FFh,0FFh,0FFh,0E0h,0DFh,80h,0FFh,0FFh,0FEh,0F5h,0FEh,0FFh,0FFh
 db 0FFh,0FFh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,0AAh,54h,0FAh,0FDh,00h,0FEh,00h,0FFh,0FFh,0FFh,0FFh,0FEh,00h,0FFh
 db 00h,0FDh,0FBh,0FFh,0FFh,0FFh,00h,0FFh,00h,0FFh,0FFh,0AAh,40h,0AAh,0FDh,0FFh
 db 0FFh,0FFh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,01h
 db 07h,17h,2Fh,1Fh,2Fh,1Fh,00h,7Fh,00h,0BFh,0BFh,9Fh,43h,0FFh,00h,7Fh
 db 00h,0FFh,0FFh,0FFh,0FFh,0FFh,00h,0FFh,00h,0FFh,0FBh,07h,01h,83h,57h,0FBh
 db 0FFh,0FFh,0Dh,0Ah,05h,0Fh,0Fh,0Fh,0Fh,0Fh,1Fh,1Fh,3Fh,3Fh,7Fh,0FFh
 db 0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,01h,0FBh,07h,0FFh,0FFh,0FFh,0FFh,0FFh,01h,0FBh
 db 07h,0FFh,0FFh,0FFh,0FFh,0FFh,01h,0FBh,07h,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh
 db 0FFh,0FFh,54h,0AAh,54h,0EAh,0F4h,0EAh,0F4h,0EAh,0F5h,0EAh,0F4h,0EAh,0F4h,0EAh
 db 0F4h,0EBh,0F4h,0EAh,0F4h,0EAh,0F4h,0EAh,0F4h,0FAh,0F4h,0FAh,0F4h,0FAh,0F4h,0FAh
 db 0F4h,0FAh,0F5h,0FAh,0F4h,0FAh,0F4h,0FAh,0FCh,0FBh,0FCh,0FAh,0FCh,0FEh,0FEh,0FEh
 db 0FEh,0FEh,00h,00h,01h,0Ah,15h,0Ah,15h,0Bh,00h,00h,00h,00h,00h,00h
 ds 84
 db 7Fh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 198
dat_BA68:
 ds 291
 db 01h,00h,01h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 35
 db 03h,07h,06h,05h,02h,45h,0ABh,57h,0AFh,4Fh,2Fh,1Eh,0Ch,08h,10h,11h
 db 27h,26h,47h,56h,5Eh,5Eh,5Eh,5Fh,4Fh,27h,17h,17h,0Fh,07h,07h,07h
 db 07h,07h,07h,03h,01h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h
 db 0FFh,56h,81h,3Ch,0FFh,0E7h,0E7h,0FFh,0FFh,0EBh,55h,0A2h,00h,00h,40h,0E1h
 db 12h,0F3h,10h,0EBh,0FBh,0DAh,0FFh,2Bh,0DDh,0BEh,0BEh,0DDh,0E3h,0FFh,0FFh,0E5h
 db 0DAh,9Fh,9Fh,0FFh,0FFh,0FFh,7Eh,24h,24h,2Ch,34h,6Eh,56h,6Eh,3Ch,2Ch
 db 3Ch,3Ch,00h,00h,00h,00h,00h,00h,0C0h,0E0h,60h,0A0h,40h,0A2h,0D5h,0EAh
 db 0F5h,0F2h,74h,0B8h,30h,10h,88h,0E8h,64h,0A4h,62h,0AAh,0BAh,0BAh,0BAh,7Ah
 db 0F2h,0E4h,0E8h,0E8h,0F0h,0E0h,0E0h,0E0h,0E0h,0E0h,0E0h,0C0h,80h,00h,00h,00h
 ds 21
 db 80h,00h,80h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 39
 db 01h,01h,01h,01h,01h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 36
 db 03h,07h,07h,07h,87h,0C7h,0F7h,0E7h,0D5h,0A2h,10h,07h,0Ch,08h,10h,10h
 db 20h,20h,40h,44h,4Eh,4Fh,4Fh,4Fh,47h,21h,11h,11h,09h,09h,05h,03h
 db 03h,01h,01h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h
 db 0FFh,01h,0AAh,0D4h,0FAh,0FFh,0FDh,0FAh,54h,0A9h,07h,0FEh,00h,00h,02h,27h
 db 3Ch,0FBh,0FEh,0FDh,0FDh,0FDh,0FDh,0FEh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FEh
 db 0FDh,0FBh,0F3h,0F3h,0FFh,7Fh,3Fh,24h,34h,2Ch,36h,2Fh,37h,2Eh,38h,3Ch
 db 3Ch,3Ch,00h,00h,00h,00h,00h,00h,0C0h,0E0h,0E0h,0E0h,0C3h,0A7h,5Fh,0BFh
 db 7Fh,0FFh,56h,0A8h,10h,08h,04h,0E2h,59h,0C4h,42h,0C1h,0C0h,40h,0C0h,70h
 db 0F8h,0FCh,0FCh,0FCh,0D8h,0E0h,0E0h,80h,60h,0E0h,0E0h,0C0h,0C0h,0C0h,80h,00h
 ds 19
 db 0E0h,0F0h,0D0h,0F0h,0E0h,0C0h,00h,00h,00h,00h,00h,00h,00h,00h,80h,80h
 ds 40
 db 07h,0Fh,0Bh,0Fh,07h,03h,00h,00h,00h,00h,00h,00h,00h,00h,01h,01h
 ds 37
 db 03h,07h,07h,07h,0C3h,0E5h,0FAh,0FDh,0FEh,0FFh,6Ah,15h,08h,10h,20h,47h
 db 9Ah,23h,42h,83h,03h,02h,03h,0Eh,1Fh,3Fh,3Fh,3Fh,1Bh,07h,07h,01h
 db 06h,07h,07h,03h,03h,03h,01h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h
 db 0FFh,80h,55h,2Bh,5Fh,0FFh,0BFh,5Fh,2Ah,95h,0E0h,7Fh,00h,00h,40h,0E4h
 db 3Ch,0DFh,7Fh,0BFh,0BFh,0BFh,0BFh,7Fh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,7Fh
 db 0BFh,0DFh,0CFh,0CFh,0FFh,0FEh,0FCh,24h,2Ch,34h,6Ch,0F4h,0ECh,74h,1Ch,3Ch
 db 3Ch,3Ch,00h,00h,00h,00h,00h,00h,0C0h,0E0h,0E0h,0E0h,0E1h,0E3h,0EFh,0E7h
 db 0ABh,45h,08h,0E0h,30h,10h,08h,08h,04h,04h,02h,22h,72h,0F2h,0F2h,0F2h
 db 0E2h,84h,88h,88h,90h,90h,0A0h,0C0h,0C0h,80h,80h,00h,00h,00h,00h,00h
 ds 20
 db 80h,80h,80h,80h,80h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 43
 db 01h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 33
 db 03h,06h,05h,02h,05h,13h,0A7h,4Fh,0AFh,4Fh,2Fh,1Eh,0Ch,08h,10h,11h
 db 27h,27h,47h,57h,5Fh,5Fh,5Fh,5Fh,4Fh,27h,17h,17h,0Fh,07h,07h,07h
 db 07h,03h,03h,01h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h
 db 2Ah,81h,7Eh,0FFh,0E7h,0E7h,0FFh,0FFh,0FFh,0EBh,55h,0A2h,00h,00h,40h,0E1h
 db 73h,0B3h,0D2h,0FBh,1Ah,0FFh,0EBh,0DDh,0BEh,0BEh,0DDh,0E3h,0FFh,0FFh,0C1h,0BEh
 db 0FFh,0FFh,0FFh,0FFh,0FFh,7Eh,3Ch,24h,7Eh,7Eh,3Ch,14h,2Ch,34h,2Ch,34h
 db 2Ch,3Ch,00h,00h,00h,00h,00h,00h,0C0h,60h,0A0h,40h,0A0h,0C8h,0E5h,0EAh
 db 0F5h,0F2h,74h,0B8h,30h,10h,88h,0E8h,0A4h,64h,0E2h,0EAh,3Ah,0FAh,0FAh,0FAh
 db 0F2h,0E4h,0E8h,0E8h,0F0h,0E0h,0E0h,0E0h,0E0h,0C0h,0C0h,80h,00h,00h,00h,00h
 ds 23
 db 80h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 38
 db 01h,00h,01h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 35
 db 03h,07h,06h,05h,02h,45h,0ABh,57h,0AFh,4Fh,2Fh,1Eh,0Ch,02h,00h,00h
 ds 40
 db 0FFh,56h,81h,3Ch,0FFh,0E7h,0E7h,0FFh,0FFh,0EBh,55h,80h,00h,0AAh,00h,00h
 db 00h,00h,00h,00h,00h,12h,12h,12h,12h,12h,12h,73h,0FFh,7Fh,0FFh,7Fh
 db 3Fh,5Ah,0F3h,73h,33h,12h,12h,12h,12h,12h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h
 db 0C0h,0E0h,60h,0A0h,40h,0A2h,0D5h,0EAh,0F5h,0F2h,74h,0B8h,70h,80h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 80h,0C0h,0E0h,0C0h,80h,40h,80h,0C0h,80h,00h,00h,00h,00h,00h,00h,00h
 ds 17
 db 80h,00h,80h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 40
 db 01h,00h,01h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 35
 db 03h,07h,06h,05h,02h,45h,0ABh,57h,0AFh,4Fh,2Fh,1Eh,0Ch,02h,00h,00h
 ds 40
 db 0FFh,56h,81h,3Ch,0FFh,0E7h,0E7h,0FFh,0FFh,0EBh,55h,80h,00h,0AAh,00h,00h
 db 00h,00h,00h,00h,00h,12h,00h,12h,00h,12h,00h,13h,2Eh,55h,2Ah,55h
 db 3Eh,1Ah,71h,52h,21h,12h,00h,12h,00h,12h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h
 db 0C0h,0E0h,60h,0A0h,40h,0A2h,0D5h,0EAh,0F5h,0F2h,74h,0B8h,70h,80h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 80h,40h,80h,40h,80h,00h,00h,80h,80h,00h,00h,00h,00h,00h,00h,00h
 ds 17
 db 80h,00h,80h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 40
 db 01h,00h,01h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 35
 db 03h,07h,06h,05h,02h,45h,0ABh,57h,0AFh,4Fh,2Fh,1Eh,0Ch,02h,00h,00h
 ds 40
 db 0FFh,56h,81h,3Ch,0FFh,0E7h,0E7h,0FFh,0FFh,0EBh,55h,80h,00h,0AAh,00h,00h
 ds 40
 db 0C0h,0E0h,60h,0A0h,40h,0A2h,0D5h,0EAh,0F5h,0F2h,74h,0B8h,70h,80h,00h,00h
 ds 45
 db 80h,00h,80h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 69
dat_C350:
 db 00h,18h,1Fh,21h,1Fh,21h,1Fh,1Ah,1Fh,21h,1Fh,21h,1Fh,18h,1Fh,21h
 db 1Fh,21h,1Fh,1Ah,1Fh,21h,1Fh,21h,1Fh,18h,1Fh,21h,1Fh,21h,1Fh,1Ah
 db 1Fh,21h,1Fh,21h,1Fh,18h,1Fh,21h,1Fh,21h,1Fh,1Ah,1Fh,21h,1Fh,21h
 db 1Fh,18h,1Fh,21h,1Fh,21h,1Fh,1Ah,1Fh,21h,1Fh,21h,1Eh,1Ah,1Fh,21h
 db 1Fh,21h,1Fh,1Ah,1Fh,21h,1Fh,23h,1Fh,18h,1Fh,21h,1Fh,21h,1Fh,1Ah
 db 1Fh,21h,1Fh,21h,1Fh,18h,1Fh,21h,1Fh,21h,1Fh,18h,1Dh,21h,1Dh,21h
 db 1Dh,18h,1Fh,21h,1Fh,21h,1Fh,18h,1Fh,21h,1Fh,21h,1Fh,1Ah,1Fh,21h
 db 1Fh,21h,1Fh,18h,1Fh,21h,1Fh,21h,1Fh,1Ah,1Fh,21h,1Fh,21h,1Fh,3Fh
 ds 897,35h
 db 24h,24h,35h,35h,35h,35h,2Bh,2Bh,35h,35h,2Dh,2Dh,2Bh,2Bh,35h,35h
 db 35h,35h,26h,26h,35h,35h,35h,35h,24h,24h,2Bh,2Bh,2Bh,2Bh,2Bh,2Bh
 db 35h,35h,2Dh,2Dh,2Bh,2Bh,2Bh,2Bh,2Bh,2Bh,2Bh,2Bh,35h,35h,35h,35h
 db 24h,24h,2Bh,2Bh,2Dh,2Bh,30h,30h,32h,32h,30h,30h,24h,24h,26h,26h
 db 28h,28h,27h,27h,24h,24h,26h,24h,28h,28h,2Bh,2Bh,2Bh,2Bh,2Bh,2Bh
 db 24h,24h,26h,26h,24h,24h,35h,35h,35h,35h,18h,1Fh,35h,35h,35h,35h
 db 35h,35h,35h,35h,35h,35h,3Fh,35h,35h,35h,35h,35h,35h,35h,35h,35h
 ds 864,35h
 db 0Ch,13h,15h,13h,13h,15h,0Eh,13h,15h,13h,15h,13h,0Eh,13h,15h,13h
 db 15h,13h,0Eh,13h,15h,13h,15h,13h,0Eh,13h,15h,13h,15h,13h,0Eh,13h
 db 15h,13h,15h,13h,0Eh,13h,15h,13h,15h,13h,0Eh,13h,15h,13h,15h,13h
 db 0Eh,13h,15h,13h,15h,13h,0Eh,13h,15h,13h,15h,13h,0Eh,13h,15h,13h
 db 15h,13h,0Eh,13h,15h,13h,15h,13h,0Eh,13h,15h,13h,15h,13h,0Eh,13h
 db 15h,13h,15h,13h,0Eh,13h,15h,13h,15h,13h,0Eh,13h,15h,13h,15h,13h
 db 0Eh,13h,15h,13h,15h,13h,0Eh,13h,15h,13h,15h,13h,0Eh,13h,15h,13h
 db 15h,13h,0Eh,13h,15h,13h,15h,13h,0Eh,13h,15h,13h,15h,13h,3Fh,35h
 ds 870,35h
 db 00h,00h,4Dh,4Fh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 127
 db 8Eh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 117
 db 0CEh,8Eh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 88
 db 3Fh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 605
 db 0C3h,0A5h,0FBh,21h,13h,0C2h,11h,12h,0FAh,01h,2Ch,01h,0EDh,0B0h,0C9h,00h
 db 00h,00h,1Bh,01h,1Bh,01h,36h,02h,00h,0FAh,00h,00h,00h,00h,00h,00h
 db 10h,02h,00h,02h,02h,04h,02h,00h,00h,00h,00h,00h,00h,00h,0DEh,0EAh
 db 61h,0EAh,0C6h,0EEh,49h,0EEh,0AEh,0F2h,31h,0F2h,92h,0F7h,19h,0F6h,0E3h,08h
 db 07h,06h,05h,06h,07h,08h,09h,0Ah,0Bh,0Bh,0Bh,0Bh,0Bh,0Bh,0Bh,0Fh
 db 0Eh,0Dh,0Ch,0Bh,0Ah,09h,08h,07h,06h,05h,04h,03h,02h,01h,00h,09h
 db 09h,0Ah,0Ah,0Ah,0Ah,08h,08h,08h,08h,0Ah,0Ah,0Ah,0Ah,09h,09h,04h
 db 06h,08h,0Ah,0Bh,0Ch,0Dh,0Eh,0Fh,0Eh,0Dh,0Ch,0Bh,0Ah,07h,03h,08h
 db 0Ch,0Ch,0Ch,0Ch,0Ch,0Ch,0Ch,0Ch,0Ch,0Ch,0Ch,0Ch
 db 0Bh,09h,08h,0Bh,0Bh,0Bh,0Bh,0Bh,0Bh,0Bh,0Bh,08h,05h,02h,02h,03h
 db 03h,03h,03h,08h,0Bh,0Dh,0Eh,0Fh,0Fh,0Eh,0Dh,0Ch,0Bh,0Ah,09h,08h
 db 08h,08h,08h,0Fh,0Bh,07h,09h,0Bh,09h,07h,09h,0Bh,09h,06h,08h,0Ah
 db 07h,05h,08h,9Fh,06h,40h,06h,0E6h,05h,91h,05h,41h,05h,0F6h,04h,0AEh
 db 04h,6Bh,04h,2Ch,04h,0F0h,03h,0B7h,03h,82h,03h,4Fh,03h,20h,03h,0F3h
 db 02h,0C8h,02h,0A1h,02h,7Bh,02h,57h,02h,36h,02h,16h,02h,0F8h,01h,0DCh
 db 01h,0C1h,01h,0A8h,01h,90h,01h,79h,01h,64h,01h,50h,01h,3Dh,01h,2Ch
 db 01h,1Bh,01h,0Bh,01h,0FCh,00h,0EEh,00h,0E0h,00h,0D4h,00h,0C8h,00h,0BDh
 db 00h,0B2h,00h,0A8h,00h,9Fh,00h,96h,00h,8Dh,00h,85h,00h,7Eh,00h,77h
 db 00h,70h,00h,6Ah,00h,64h,00h,5Eh,00h,59h,00h,54h,00h,0FFh,0FFh,08h
 db 09h,18h,09h,00h,80h,1Ch,80h,04h,10h,0Ch,10h,14h,10h,1Ch,10h,1Eh
 db 20h,00h,00h,00h,00h,00h,00h,00h,00h,0CDh,51h,0FBh,0CDh,8Eh,02h,1Ch
 db 28h,0F7h,0C3h,0C7h,0FBh,0F3h,21h,19h,0FAh,06h,0FFh,70h,23h,04h,0CDh,0D9h
 db 0FCh,21h,20h,0FAh,70h,23h,0CDh,0D9h,0FCh,21h,27h,0FAh,70h,23h,0CDh,0D9h
 db 0FCh,23h,0CDh,0D9h,0FCh,21h,3Ah,0FAh,0CDh,0D0h,0FBh,0CDh,9Dh,0FCh,21h,2Eh
 db 0FAh,0CDh,0D0h,0FBh,3Eh,01h,0CDh,0F4h,0FBh,21h,32h,0FAh,0CDh,0D0h,0FBh,3Eh
 db 02h,0CDh,0F4h,0FBh,21h,36h,0FAh,0CDh,0D0h,0FBh,3Eh,03h,0CDh,0F4h,0FBh,0CDh
 db 15h,0FDh,0CDh,0C6h,0FDh,0CDh,72h,0FCh,0C9h,21h,60h,0EAh,11h,2Eh,0FAh,01h
 db 0E8h,03h,0CDh,0BDh,0FBh,0CDh,0BDh,0FBh,0CDh,0BDh,0FBh,0CDh,0BDh,0FBh,0C3h,45h
 db 0FBh,7Dh,12h,13h,7Ch,12h,13h,09h,13h,13h,0C9h,16h,07h,1Eh,0FFh,0CDh
 db 0B8h,0FDh,0FBh,0C9h,5Eh,23h,56h,13h,1Ah,0FEh,3Fh,0CAh,0EBh,0FBh,47h,72h
 db 2Bh,73h,87h,5Fh,16h,00h,21h,0BFh,0FAh,19h,56h,23h,5Eh,0EBh,0C9h,23h
 db 5Eh,23h,56h,2Bh,2Bh,0C3h,0D4h,0FBh,4Fh,78h,0FEh,36h,30h,3Fh,3Eh,0FFh
 db 0BCh,0C8h,79h,0E5h,87h,3Dh,21h,12h,0FAh,16h,00h,5Fh,19h,0D1h,73h,2Bh
 db 72h,21h,24h,0FAh,16h,00h,59h,19h,2Bh,7Eh,2Bh,2Bh,2Bh,77h,21h,0Fh
 db 0FAh,19h,2Bh,7Eh,21h,19h,0FAh,19h,77h,21h,19h,0FAh,0Dh,0C2h,2Eh,0FCh
 db 0CBh,86h,0Dh,0C2h,34h,0FCh,0CBh,8Eh,0Dh,0C0h,0CBh,96h,0C9h,7Ch,32h,18h
 db 0FAh,7Dh,0E6h,0F0h,0FEh,00h,28h,1Fh,0Fh,0Fh,0Fh,0Fh,21h,21h,0FAh,16h
 db 00h,59h,19h,2Bh,77h,21h,19h,0FAh,0Dh,20h,03h,0CBh,9Eh,0C9h,0Dh,20h
 db 03h,0CBh,0A6h,0C9h,0CBh,0AEh,0C9h,7Dh,0E6h,0Fh,21h,1Ah,0FAh,16h,00h,59h
 db 19h,2Bh,77h,0AFh,18h,0D6h,3Eh,01h,0CDh,0D5h,0FDh,3Eh,02h,0CDh,0D5h,0FDh
 db 3Eh,03h,0CDh,0D5h,0FDh,0CDh,0C6h,0FDh,3Ah,3Eh,0FAh,06h,32h,00h,10h,0FDh
 db 3Ch,20h,0F8h,0CDh,95h,0FDh,21h,20h,0FAh,34h,7Eh,0FEh,10h,0C8h,0C3h,72h
 db 0FCh,78h,0E6h,03h,4Fh,0CBh,50h,20h,06h,0CBh,58h,0C2h,0DFh,0FCh,0C9h,0CBh
 db 58h,0C2h,0F5h,0FCh,3Eh,0F0h,0A0h,0CBh,0Fh,0CBh,0Fh,0CBh,0Fh,0CBh,0Fh,47h
 db 0AFh,0B9h,28h,0Eh,21h,0Fh,0FAh,16h,00h,59h,19h,2Bh,70h,06h,00h,0C3h
 db 05h,0FDh,21h,0Fh,0FAh,0CDh,0D9h,0FCh,06h,00h,0C3h,0Fh,0FDh,70h,23h,70h
 db 23h,70h,0C9h,79h,32h,3Fh,0FBh,3Eh,0F0h,0A0h,07h,07h,07h,0CBh,60h,47h
 db 28h,03h,0EEh,7Fh,3Ch,32h,27h,0FAh,0C9h,0CBh,60h,0C0h,3Eh,0E0h,0A0h,07h
 db 0CBh,07h,0CBh,07h,47h,0AFh,0B9h,28h,0Ah,16h,00h,59h,21h,24h,0FAh,19h
 db 2Bh,70h,0C9h,21h,24h,0FAh,0C3h,0D9h,0FCh,21h,27h,0FAh,0AFh,0BEh,0C8h,46h
 db 3Ah,3Fh,0FBh,0FEh,00h,28h,20h,0DDh,21h,12h,0FAh,21h,2Eh,0FAh,3Dh,0CAh
 db 5Eh,0FDh,21h,32h,0FAh,0DDh,23h,0DDh,23h,3Dh,0CAh,5Eh,0FDh,21h,36h,0FAh
 db 0DDh,23h,0DDh,23h,0C3h,5Eh,0FDh,21h,2Eh,0FAh,0DDh,21h,12h,0FAh,0CDh,5Eh
 db 0FDh,0DDh,23h,0DDh,23h,21h,32h,0FAh,0CDh,5Eh,0FDh,0DDh,23h,0DDh,23h,21h
 db 36h,0FAh,5Eh,23h,56h,1Ah,80h,0FEh,35h,0D0h,16h,00h,87h,5Fh,21h,0BFh
 db 0FAh,19h,5Eh,23h,56h,0DDh,6Eh,00h,0DDh,66h,01h,0EBh,0AFh,0EDh,52h,7Dh
 db 6Ch,67h,0AFh,0C5h,06h,04h,0EEh,00h,0CBh,1Ch,0CBh,1Dh,0CBh,1Fh,10h,0F6h
 db 0B4h,0DDh,77h,16h,0DDh,75h,17h,0C1h,0C9h,21h,12h,0FAh,11h,28h,0FAh,06h
 db 03h,7Eh,0E5h,23h,66h,6Fh,0EBh,7Eh,23h,0E5h,66h,6Fh,19h,30h,01h,23h
 db 4Ch,7Dh,0D1h,13h,0E1h,77h,23h,71h,23h,10h,0E6h,0C9h,0C5h,01h,0FDh,0FFh
 db 0EDh,51h,01h,0FDh,0BFh,0EDh,59h,0C1h,14h,0C9h,21h,12h,0FAh,16h,00h,06h
 db 0Eh,5Eh,23h,0CDh,0B8h,0FDh,10h,0F9h,0C9h,21h,1Ah,0FAh,3Dh,5Fh,16h,00h
 db 19h,0EBh,21h,07h,00h,19h,7Eh,0FEh,00h,0C8h,0D5h,21h,3Fh,0FAh,3Dh,17h
 db 17h,17h,17h,16h,00h,5Fh,19h,3Ah,20h,0FAh,5Fh,19h,7Eh,0E1h,77h,0C9h
 ds 1486
 db 7Fh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 62
 db 41h,41h,63h,77h,77h,77h,36h,00h,14h,14h,14h,77h,77h,77h,77h,00h
 db 34h,60h,60h,77h,77h,77h,77h,00h,16h,03h,43h,77h,77h,77h,36h,00h
 db 46h,77h,77h,77h,06h,07h,07h,00h,16h,03h,43h,77h,77h,77h,36h,00h
 db 76h,43h,43h,77h,77h,77h,36h,00h,30h,30h,60h,60h,70h,70h,70h,00h
 db 36h,41h,41h,77h,77h,77h,36h,00h,17h,01h,41h,77h,77h,77h,36h,00h
 db 08h,2Bh,6Bh,6Bh,6Bh,6Bh,68h,28h,00h,00h,00h,00h,00h,00h,00h,00h
 db 0Ah,0Bh,6Bh,6Bh,6Bh,6Bh,6Ah,08h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 36h,77h,77h,77h,63h,41h,41h,00h,14h,34h,74h,74h,54h,14h,14h,00h
 db 36h,77h,77h,77h,43h,03h,16h,00h,77h,77h,77h,77h,03h,06h,14h,00h
 db 06h,06h,16h,16h,36h,26h,66h,00h,77h,77h,77h,77h,40h,40h,74h,00h
 db 36h,77h,77h,77h,41h,40h,74h,00h,77h,77h,77h,43h,06h,04h,10h,00h
 db 36h,77h,77h,77h,41h,41h,36h,00h,36h,77h,77h,77h,41h,41h,37h,00h
 ds 56
 db 1Ch,1Ch,1Ch,1Ch,08h,14h,14h,00h,76h,77h,77h,77h,21h,21h,36h,00h
 db 37h,77h,77h,63h,40h,40h,40h,00h,76h,77h,77h,77h,23h,21h,21h,00h
 db 77h,77h,77h,77h,23h,20h,2Ch,00h,77h,77h,77h,77h,23h,20h,2Ch,00h
 db 37h,77h,77h,63h,40h,40h,57h,00h,77h,77h,77h,77h,22h,22h,36h,00h
 db 3Ah,3Ah,3Ah,3Ah,08h,08h,08h,00h,07h,07h,07h,07h,02h,02h,02h,00h
 db 70h,77h,77h,77h,27h,28h,30h,00h,70h,70h,70h,70h,20h,20h,20h,00h
 db 63h,63h,63h,77h,36h,2Ah,2Ah,00h,67h,67h,67h,77h,32h,2Ah,2Ah,00h
 db 36h,77h,77h,77h,63h,41h,41h,00h,76h,77h,77h,77h,23h,21h,21h,00h
 db 36h,77h,77h,77h,63h,41h,41h,00h,76h,77h,77h,77h,23h,21h,21h,00h
 db 37h,77h,77h,77h,63h,60h,34h,00h,7Bh,7Bh,7Bh,7Bh,49h,08h,08h,00h
 db 77h,77h,77h,77h,22h,22h,22h,00h,77h,77h,77h,77h,22h,22h,14h,00h
 db 77h,77h,77h,77h,22h,22h,22h,00h,77h,77h,77h,77h,22h,36h,14h,00h
 db 77h,77h,77h,77h,22h,32h,10h,00h,77h,77h,77h,77h,42h,04h,00h,00h
 ds 47
 db 14h,3Eh,22h,77h,77h,77h,77h,00h,21h,21h,21h,21h,77h,77h,76h,00h
 db 40h,40h,41h,63h,77h,77h,36h,00h,21h,21h,23h,77h,77h,77h,76h,00h
 db 3Ch,2Ch,21h,77h,77h,77h,77h,00h,3Ch,2Ch,20h,70h,70h,70h,70h,00h
 db 57h,51h,41h,63h,77h,77h,35h,00h,36h,36h,22h,22h,77h,77h,77h,00h
 db 08h,08h,08h,3Ah,3Ah,3Ah,3Ah,00h,02h,02h,42h,76h,76h,76h,34h,00h
 db 30h,28h,24h,77h,77h,77h,77h,00h,20h,20h,21h,77h,77h,77h,77h,00h
 db 22h,22h,22h,77h,77h,77h,77h,00h,26h,26h,22h,73h,73h,73h,73h,00h
 db 41h,41h,63h,77h,77h,77h,36h,00h,23h,36h,20h,70h,70h,70h,70h,00h
 db 41h,4Dh,6Fh,76h,77h,73h,33h,00h,23h,36h,24h,76h,73h,73h,73h,00h
 db 16h,03h,63h,77h,77h,77h,76h,00h,08h,08h,08h,3Ah,3Ah,3Ah,3Ah,00h
 db 22h,22h,22h,36h,36h,36h,14h,00h,14h,14h,08h,1Ch,1Ch,1Ch,1Ch,00h
 db 2Ah,2Ah,36h,77h,63h,63h,63h,00h,14h,36h,22h,77h,77h,77h,77h,00h
 db 18h,08h,08h,3Ah,3Ah,3Ah,3Ah,00h,00h,10h,21h,77h,77h,77h,77h,00h
 ds 2696
; Intro: pantalla del menú. El BASIC de la cinta salta aquí (RANDOMIZE USR 60000).
; Borra la pantalla, pinta el menú (txt_menu, 360 bytes con códigos de control de PRINT AT/INK) y los cuatro
; gráficos del título (draw_cells las dibuja en celdas de 8×8).
intro:      ld   a,02h
            call rom_chan_open
            call title_reset
            ld   bc,01F4h
            ld   (menu_timeout),bc
            ld   a,03h
            ld   (sel_a),a
            inc  a
            ld   (sel_b),a
lbl_EA78:   xor  a
            ld   (menu_flag),a
            out  (0FEh),a
            ld   a,0DCh
            ld   (ERR_NR_mark),a
            ld   hl,4000h
            ld   bc,1800h
lbl_EA89:   xor  a
            ld   (hl),a
            inc  hl
            dec  bc
            ld   a,b
            or   c
            jr   nz,lbl_EA89
            ld   hl,5800h
            ld   bc,0300h
lbl_EA97:   ld   a,06h
            ld   (hl),a
            inc  hl
            dec  bc
            ld   a,b
            or   c
            jr   nz,lbl_EA97
            ld   de,txt_menu
            ld   bc,0168h
            call rom_print_str
            ld   a,3Ch
            ld   (ERR_NR_mark),a
            ld   ix,title_sprite1
            ld   de,gfx_title1
            call draw_cells
            ld   ix,title_sprite2
            ld   de,gfx_title2
            call draw_cells
            ld   ix,title_sprite3
            ld   de,gfx_title3
            call draw_cells
            ld   ix,title_sprite4
            ld   de,gfx_title4
            call draw_cells
            jp   menu_loop
txt_menu:
 db 10h,05h,11h,01h,13h,01h,10h,05h,11h,01h,16h,01h
 db 01h," SHOOT LAND ",16h,02h,01h,10h,04h," shoot land ",16h,00h,01h," "
 db "           ",16h,03h,01h,10h,03h," 1 KEMPSTON ",10h,02h,16h,04h,01h
 db " ",22h," kempston ",10h,03h,16h,05h,01h," 2 KEYBOARD ",16h,06h,01h
 db 10h,02h," # keyboard ",16h,07h,01h,10h,03h," 3 SINCLAIR ",16h,08h,01h
 db 10h,02h," $ sinclair ",16h,09h,01h,10h,03h," 4 CURSOR   ",16h,0Ah,01h
 db 10h,02h," % cursor   ",16h,0Bh,01h,10h,03h,"            ",16h,0Ch,01h
 db 10h,02h,"            ",16h,0Dh,01h,10h,06h," 0 EMPEZAR  ",16h,0Eh,01h
 db 10h,05h," ! empezar  ",16h,0Fh,01h,"            ",10h,02h,11h,00h,16h
 db 0Ah,11h,"  ",16h,0Ah,1Ah,"  ",16h,0Bh,11h,"    ",16h
 db 0Bh,18h,"    ",16h,0Ch,11h,"           ",16h,0Dh,11h,"           ",16h
 db 0Eh,11h,"           ",16h,0Fh,11h,"           "
txt_sel_a:
 db 16h
sel_a:
 db 00h,01h,10h,07h,15h,01h,11h,01h,20h,20h,20h,20h,20h,20h,20h,20h
 db 20h,20h,20h,20h,16h
sel_b:
 db 00h,01h,10h,06h,20h,20h,20h,20h,20h,20h,20h,20h,20h,20h,20h,20h
txt_sel_b:
 db 16h
dat_EC68:
 db 00h,01h,10h,03h,15h,01h,11h,01h,20h,20h,20h,20h,20h,20h,20h,20h
 db 20h,20h,20h,20h,16h
dat_EC7D:
 db 00h,01h,10h,02h,20h,20h,20h,20h,20h,20h,20h,20h,20h,20h,20h,20h
menu_timeout:
 db 00h,00h
menu_flag:
 db 00h
title_sprite1:
 db 16h,02h,00h,0Fh
title_sprite2:
 db 16h,02h,00h,1Ch
title_sprite3:
 db 02h,0Bh,00h,11h
title_sprite4:
 db 06h,0Bh,0Ah,11h
; Bucle del menú. Teclas 1–4 (fila F7h): elige el control y lo marca; 0 (fila EFh, bit 0): empezar.
; La opción se guarda en FFFFh, donde la lee el motor.
menu_loop:  ld   de,txt_sel_a
            ld   bc,0026h
            call rom_print_str
lbl_ECA9:   ld   bc,(menu_timeout)
            dec  bc
            ld   (menu_timeout),bc
            ld   a,b
            or   c
            push af
            call title_animate
            pop  af
            jp   z,credits_jump
            ld   a,0F7h
            in   a,(0FEh)
            bit  0,a
            jr   z,choose_kempston
            bit  1,a
            jr   z,choose_keyboard
            bit  2,a
            jr   z,choose_sinclair
            bit  3,a
            jr   z,choose_cursor
            ld   a,0EFh
            in   a,(0FEh)
            bit  0,a
            jp   z,start_game
            jr   lbl_ECA9
choose_kempston:ld   a,(sel_a)
            xor  03h
            jr   z,lbl_ECA9
            call menu_mark
            ld   a,03h
            ld   (sel_a),a
            inc  a
            ld   (sel_b),a
            ld   a,01h
            ld   (0FFFFh),a
            jr   menu_loop
choose_keyboard:ld   a,(sel_a)
            xor  05h
            jr   z,lbl_ECA9
            call menu_mark
            ld   a,05h
            ld   (sel_a),a
            inc  a
            ld   (sel_b),a
            ld   a,02h
            ld   (0FFFFh),a
            jr   menu_loop
choose_sinclair:ld   a,(sel_a)
            xor  07h
            jr   z,lbl_ECA9
            call menu_mark
            ld   a,07h
            ld   (sel_a),a
            inc  a
            ld   (sel_b),a
            ld   a,03h
            ld   (0FFFFh),a
            jp   menu_loop
choose_cursor:ld   a,(sel_a)
            xor  09h
            jp   z,lbl_ECA9
            call menu_mark
            ld   a,09h
            ld   (sel_a),a
            inc  a
            ld   (sel_b),a
            ld   a,04h
            ld   (0FFFFh),a
            jp   menu_loop
menu_mark:  ld   de,txt_sel_b
            ld   a,(sel_a)
            ld   (dat_EC68),a
            ld   a,(sel_b)
            ld   (dat_EC7D),a
            ld   bc,01F4h
            ld   (menu_timeout),bc
            ld   bc,0026h
            jp   rom_print_str
; Empezar: animación de salida y lanza el motor (launch_engine).
start_game: ld   b,0FFh
            ld   a,01h
lbl_ED66:   push bc
            push af
            ld   b,a
            ld   de,dat_ED9A
lbl_ED6C:   inc  de
            djnz lbl_ED6C
            ld   a,(de)
            ld   b,a
            ld   de,dat_BA68
lbl_ED74:   push bc
            ld   b,8Ch
lbl_ED77:   inc  de
            inc  de
            djnz lbl_ED77
            pop  bc
            djnz lbl_ED74
            ld   ix,title_cells
            call draw_cells
            ld   bc,03E8h
lbl_ED88:   ld   a,00h
            out  (0FEh),a
            dec  bc
            ld   a,b
            or   c
            jr   nz,lbl_ED88
            pop  af
            inc  a
            pop  bc
            djnz lbl_ED66
            jp   launch_engine
 db 0C9h
dat_ED9A:
 ds 23,01h
 ds 23,02h
 ds 23,01h
 ds 23,03h
 ds 32,01h
 db 04h,04h,04h,04h,04h,04h,04h,04h,04h,04h,04h,04h,04h,04h
 ds 23,01h
 db 05h,05h,05h,05h,05h,06h,06h,06h,06h,06h,07h,07h,07h,07h,07h,07h
 ds 99,07h
credits_jump:jp   show_credits
 db 04h,05h,12h,00h,00h,0DDh,21h,0B1h,0EEh,0CDh,0C0h,0EEh,0CDh,99h,0EDh
draw_cells: ld   b,(ix+02h)
            ld   c,(ix+03h)
            ld   a,(ix+01h)
lbl_EEC9:   push af
            ld   a,(ix+00h)
lbl_EECD:   push af
            ld   h,40h
            ld   a,b
            and  18h
            add  a,h
            ld   h,a
            ld   a,b
            and  07h
            rrca
            rrca
            rrca
            add  a,c
            ld   l,a
            push bc
            ld   b,08h
lbl_EEE0:   ld   a,(de)
            ld   (hl),a
            inc  de
            inc  h
            djnz lbl_EEE0
            pop  bc
            pop  af
            inc  b
            dec  a
            jr   nz,lbl_EECD
            pop  af
            ld   b,(ix+02h)
            inc  c
            dec  a
            jr   nz,lbl_EEC9
            ret
show_credits:ld   hl,5800h
            ld   a,00h
            out  (0FEh),a
            ld   bc,0300h
lbl_EEFF:   dec  bc
            ld   (hl),00h
            inc  hl
            ld   a,b
            or   c
            jr   nz,lbl_EEFF
            ld   a,0DCh
            ld   (ERR_NR_mark),a
            ld   de,txt_credits
            ld   bc,0100h
            call rom_print_str
            ld   a,3Ch
            ld   (ERR_NR_mark),a
            ld   a,(FLAGS)
            xor  0CCh
            jr   z,lbl_EF27
            call swap_ending
            jp   lbl_EA78
lbl_EF27:   call music_run
            jp   lbl_EA78
 db 0C3h,78h,0EAh
; Créditos de la intro.
txt_credits:
 db 16h,02h,02h,10h,05h,15h,00h,11h,00h,"PROGRAMADO POR FERNANDO P",16h,06h
 db 02h,"GRAFICOS",16h,08h,0Bh,"ALBERTO HERRAIZ",16h,0Ch,0Bh,"FERNANDO PEREZ",16h,10h
 db 02h,"MUSICA J TORRES.",16h,14h,03h,10h,04h,"  ZAFIRO  1988 SPANIS SOFT",16h,03h,02h,10h
 db 03h,"programado por fernando p",16h,07h,02h,"graficos",16h,09h,0Bh,"alberto herraiz",16h,0Dh
 db 0Bh,"fernando perez",16h,11h,02h,"musica j torres.",16h,15h,03h,10h,01h," "
 db " zafiro  ",22h,"*)) spanis soft"
title_animate:ld   a,(title_frame)
            ld   b,a
            inc  a
            ld   (title_frame),a
            xor  64h
            call z,title_reset
            ld   de,dat_F071
lbl_F040:   inc  de
            djnz lbl_F040
            ld   a,(de)
            ld   de,dat_BA68
            ld   b,a
lbl_F048:   push bc
            ld   b,8Ch
lbl_F04B:   inc  de
            inc  de
            djnz lbl_F04B
            pop  bc
            djnz lbl_F048
            ld   ix,title_cells
            call draw_cells
            ld   bc,05DCh
lbl_F05C:   ld   a,00h
            out  (0FEh),a
            dec  bc
            ld   a,b
            or   c
            jr   nz,lbl_F05C
            ret
title_reset:ld   a,01h
            ld   (title_frame),a
            ret
title_frame:
 db 00h
title_cells:
 db 07h,05h,05h,14h
dat_F071:
 ds 23,01h
 ds 23,02h
 ds 23,01h
 ds 23,03h
 ds 23,01h
; Copia el cargador de abajo (stub_loader, 100 bytes) encima de la música (AFC8h) y salta a él: así
; puede cargar el motor sin pisarse a sí mismo.
launch_engine:ld   hl,stub_loader
            ld   de,music_run
            ld   bc,0064h
            ldir
            jp   music_run

 org 0F0F2h
 phase 0AFC8h
; stub_loader: se ejecuta en AFC8h (PHASE). Carga el motor (10370 bytes sin cabecera) en D778h con
; LD-BYTES, lo reparte con tres LDIR (hud_gfx → CF08h, fuente → DD00h, sprites → C350h; el resto se queda
; en EA60h) y salta a EA60h.
stub_start: ld   ix,0D778h
            ld   de,2882h
            ld   a,52h
            ld   (ERR_SP),a
            ld   a,0FFh
            scf
            call rom_ld_bytes
            jr   nc,0AFBAh
            ld   hl,0D778h
            ld   de,0CF08h
            ld   bc,0900h
            ldir
            ld   hl,0E078h
            ld   de,0DD00h
            ld   bc,0300h
            ldir
            ld   hl,0E378h
            ld   de,0C350h
            ld   bc,06E8h
            ldir
            jp   intro
 dephase

 org 0F12Ah
; Relleno: restos de memoria que se grabaron con el bloque (ceros, un trozo de BASIC y de la fuente). No se usa.
leftover:
 ds 3564
 db 0CEh,0Bh,0FBh,50h,06h,17h,0DCh,0Ah,0D7h,18h,38h,00h,0B1h,33h,82h,5Dh
 db 05h,00h,0CEh,0Bh,0FAh,50h,07h,17h,0DBh,02h,0DBh,02h,7Ch,38h,0D4h,03h
 db 4Dh,00h,0DAh,56h,26h,00h,0D9h,56h,0Ch,02h,5Ch,0Eh,0C0h,57h,71h,0Eh
 db 21h,17h,18h,00h,2Ah,12h,0B3h,5Fh,3Dh,10h,3Ah,5Bh,00h,3Eh,0B5h,3Eh
 db 0B0h,0Dh,00h,3Ch,42h,42h,7Eh,42h,42h,00h,00h,7Ch,42h,7Ch,42h,42h
 db 7Ch,00h,00h,3Ch,42h,40h,40h,42h,3Ch,00h,00h,78h,44h,42h,42h,44h
 db 78h,00h,00h,7Eh,40h,7Ch,40h,40h,7Eh,00h,00h,7Eh,40h,7Ch,40h,40h
 db 40h,00h,00h,3Ch,42h,40h,4Eh,42h,3Ch,00h,00h,42h,42h,7Eh,42h,42h
 db 42h,00h,00h,3Eh,08h,08h,08h,08h,3Eh,00h,00h,02h,02h,02h,42h,42h
 db 3Ch,00h,00h,44h,48h,70h,48h,44h,42h,00h,00h,40h,40h,40h,40h,40h
 db 7Eh,00h,00h,42h,66h,5Ah,42h,42h,42h,00h,00h,42h,62h,52h,4Ah,46h
 db 42h,00h,00h,3Ch,42h,42h,42h,42h,3Ch,00h,00h,7Ch,42h,42h,7Ch,40h
 db 40h,00h,00h,3Ch,42h,42h,52h,4Ah,3Ch,00h,00h,7Ch,42h,42h,7Ch,44h
 db 42h,00h,00h,3Ch,40h,3Ch,02h,42h,3Ch,00h,00h,0FEh,10h,10h,10h,10h
 db 10h,00h,00h,42h,42h,42h,42h,42h,3Ch
