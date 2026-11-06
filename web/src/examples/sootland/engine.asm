; Sootland — motor
; Bloque B de la cinta (sin cabecera, 10370 bytes en D778h): marco, fuente, sprites y código del juego.
; © 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso.
; Gráficos: Alberto Herraiz y Fernando Pérez. Música: J. Torres.
; Reconstruido por ingeniería inversa de la cinta original e incluido con permiso de su autor.

; Direcciones que el motor usa fuera de sí mismo.
rom_start      equ 00000h
rom_print_a    equ 00010h
rom_ld_bytes   equ 00556h
rom_chan_open  equ 01601h
rom_print_str  equ 0203Ch
CHARS          equ 05C36h
ERR_NR_mark    equ 05C37h
BORDCR         equ 05C48h
DF_SZ          equ 05C6Bh
FRAMES         equ 05C78h
level_body     equ 061A8h
bg_buffer      equ 0AA00h
bg_attrs       equ 0BA00h
ending_code    equ 0C350h
level_header   equ 0CA38h
lvl_actors     equ 0CE40h
ending_entry   equ 0CE72h
lvl_spawns     equ 0CEA4h
hud_attrs      equ 0D708h

 org 0D778h
; El stub de carga (loader.asm) reparte el bloque con tres LDIR; PHASE da a cada pieza la dirección a la que
; se copia, así que las etiquetas valen en ejecución. Las tres son recursos editables.

; Pieza 1 → CF08h: tercio inferior de la pantalla (2048 bytes) y sus atributos (256): el marco de marcadores.
 phase 0CF08h
hud_gfx:
 incbin "hud.scr#bottom"
 dephase

; Pieza 2 → DD00h: fuente de 96 caracteres (CHARS = DC00h).
 phase 0DD00h
font:
 incbin "font.tiles"
 dephase

; Pieza 3 → C350h: celdas de 8×8 de los sprites comunes (gráficos y máscaras; ver sprite_draw).
 phase 0C350h
sprites:
 incbin "sprites.tiles"
 dephase

; Pieza 4: el código del juego, que se queda donde se cargó.
 org 0EA60h
; SOOTLAND — motor del juego (bloque B de la cinta, cara 1). La intro lo carga en D778h y salta aquí.
; Entrada: borra los atributos, pone el borde negro y pide la cara B de la cinta.
start:      xor  a
            ld   (DF_SZ),a
            ld   a,02h
            call rom_chan_open
            ld   hl,5800h
            ld   bc,0300h
lbl_EA6F:   xor  a
            ld   (hl),a
            inc  hl
            dec  bc
            ld   a,b
            or   c
            jr   nz,lbl_EA6F
            xor  a
            out  (0FEh),a
            ld   a,01h
            ld   (v_level),a
ask_rewind_side:ld   de,txt_rewind
            ld   bc,004Ch
            ld   a,0DCh
            ld   (ERR_NR_mark),a
            call rom_print_str
; Carga la cabecera del nivel (1222 bytes en CA38h, flag = nº de nivel) y su cuerpo (18432 bytes en
; 61A8h, flag = nivel + 4) con LD-BYTES de la ROM. Si falla, load_error lo cuenta y se reintenta.
load_level_1:ld   ix,level_header
            ld   de,04C6h
            ld   a,01h
            scf
            call rom_ld_bytes
            call nc,load_error
            jr   nc,load_level_1
            ld   ix,level_body
            ld   de,4800h
            ld   a,05h
            scf
            call rom_ld_bytes
            call nc,load_error
            jr   nc,load_level_1
ask_space:  ld   de,txt_press_space
            ld   bc,0041h
            ld   a,0DCh
            ld   (ERR_NR_mark),a
            call rom_print_str
            ld   hl,lvl_actors
            ld   de,actor_table
            ld   bc,0040h
            ldir
; Espera a ESPACIO (fila 7Fh de puertos, bit 0). Copia el marco de marcadores (hud_gfx) al tercio inferior
; de la pantalla y sus atributos, y escribe los marcadores con la calculadora de la ROM (STACK-A + PRINT-FP).
wait_space: ld   a,7Fh
            in   a,(0FEh)
            bit  0,a
            jr   nz,wait_space
            xor  a
            out  (0FEh),a
            ld   ix,v_score
            ld   (ix+00h),a
            ld   (ix+01h),a
            ld   (ix+02h),a
            ld   (ix+03h),a
            ld   (ix+04h),a
            ld   (ix+06h),a
            ld   hl,hud_gfx
            ld   de,5000h
            ld   bc,0800h
            ldir
            ld   hl,hud_attrs
            ld   de,5A00h
            ld   bc,0100h
            ldir
            ld   a,02h
            call rom_chan_open
            ld   a,16h
            rst  10h
            ld   a,14h
            rst  10h
            ld   a,10h
            rst  10h
            ld   a,0DCh
            ld   (ERR_NR_mark),a
            ld   ix,v_record
            ld   b,06h
lbl_EB1A:   push bc
            push ix
            ld   a,(ix+00h)
            call 2D28h
            call 2DE3h
            pop  ix
            dec  ix
            pop  bc
            djnz lbl_EB1A
            ld   ix,spr_enemy
            ld   a,16h
            rst  10h
            ld   a,15h
            rst  10h
            ld   a,10h
            rst  10h
            ld   a,0DBh
            ld   (ERR_NR_mark),a
            ld   a,88h
            ld   (CHARS),a
            ld   ix,v_record
            ld   b,06h
lbl_EB4A:   push bc
            push ix
            ld   a,(ix+00h)
            call 2D28h
            call 2DE3h
            pop  ix
            dec  ix
            pop  bc
            djnz lbl_EB4A
            xor  a
            ld   (CHARS),a
            ld   bc,00FAh
            ld   (v_time_reload),bc
            ld   bc,0032h
            ld   (v_step_timer),bc
            ld   (v_pace),bc
            ld   a,3Ch
            ld   (dat_EF26),a
            ld   a,04h
            ld   (v_lives),a
; Estado inicial de un nivel: copia la tabla de apariciones (lvl_spawns) y la de actores (lvl_actors) de
; la cabecera del nivel, y reinicia contadores.
begin_level:ld   hl,lvl_spawns
            ld   de,spawn_table
            ld   bc,005Ah
            ldir
            ld   hl,lvl_actors
            ld   de,actor_table
            ld   bc,0040h
            ldir
            xor  a
            dec  a
            ld   (v_wave),a
            ld   a,01h
            ld   (v_scene),a
            ld   (dat_EF27),a
            ld   (spr_crosshair_on),a
            ld   bc,00FAh
            ld   (v_time_reload),bc
            ld   bc,0032h
            ld   (v_step_timer),bc
            ld   (v_pace),bc
            ld   a,0Ah
            ld   (spr_crosshair_row),a
            ld   a,0Fh
            ld   (spr_crosshair_col),a
            xor  a
            ld   (bonus_active),a
; Una escena (un tablero de 4 de cada nivel): 20 enemigos y pasa al siguiente nivel.
begin_scene:ld   a,15h
            ld   (spr_enemy_col),a
            ld   (spr_enemy_row),a
            ld   a,(v_wave)
            inc  a
            ld   (v_wave),a
            xor  14h
            jp   z,next_level
            ld   bc,(v_time_reload)
            ld   (v_time),bc
            ld   (v_enemy_timer),bc
            xor  a
            ld   (v_enemy_on),a
            ld   (spr_enemy2_on),a
            ld   (spr_enemy_on),a
            ld   a,1Fh
            ld   (spr_bonus_col),a
            ld   (dat_EF2A),a
            call draw_scene
; Lee el control elegido en el menú (variable en FFFFh: 1 Kempston, 2 teclado, 3 Sinclair, 4 cursor).
; Mueve la mira (spr_crosshair_col/row) y cambia de escena al salirse por un borde.
read_controls:ld   a,(0FFFFh)
            xor  01h
            jr   z,control_kempston
            ld   a,(0FFFFh)
            xor  02h
            jr   z,control_keyboard
            ld   a,(0FFFFh)
            xor  03h
            jr   z,control_cursor
            ld   a,(0FFFFh)
            xor  04h
            jr   z,control_sinclair
            ret
control_kempston:in   a,(0E9h)
            xor  08h
            jp   z,aim_up
            in   a,(0E9h)
            xor  04h
            jp   z,aim_down
            in   a,(0E9h)
            xor  01h
            jp   z,aim_right
            in   a,(0E9h)
            xor  02h
            jp   z,aim_left
            in   a,(0E9h)
            xor  10h
            jp   z,fire
            jp   game_tick
control_keyboard:ld   a,7Fh
            in   a,(0FEh)
            bit  0,a
            jp   z,fire
            ld   a,0FBh
            in   a,(0FEh)
            bit  0,a
            jr   z,aim_up
            ld   a,0FDh
            in   a,(0FEh)
            bit  0,a
            jr   z,aim_down
            ld   a,0DFh
            in   a,(0FEh)
            bit  0,a
            jp   z,aim_right
            bit  1,a
            jr   z,aim_left
            jp   game_tick
control_sinclair:ld   a,0EFh
            in   a,(0FEh)
            bit  0,a
            jp   z,fire
            bit  2,a
            jp   z,aim_right
            bit  3,a
            jr   z,aim_up
            bit  4,a
            jr   z,aim_down
            ld   a,0F7h
            in   a,(0FEh)
            bit  4,a
            jr   z,aim_left
            jp   game_tick
control_cursor:ld   a,0EFh
            in   a,(0FEh)
            bit  0,a
            jp   z,fire
            bit  1,a
            jr   z,aim_up
            bit  2,a
            jr   z,aim_down
            bit  3,a
            jr   z,aim_right
            bit  4,a
            jr   z,aim_left
            ld   a,0FEh
            in   a,(0FEh)
            bit  0,a
            ret  z
controls_done:jp   game_tick
aim_up:     ld   a,(spr_crosshair_row)
            dec  a
            ld   (spr_crosshair_row),a
            xor  0FFh
            jr   nz,controls_done
            ld   a,00h
            ld   (spr_crosshair_row),a
            jr   controls_done
aim_down:   ld   a,(spr_crosshair_row)
            inc  a
            ld   (spr_crosshair_row),a
            xor  0Fh
            jr   nz,controls_done
            ld   a,0Eh
            ld   (spr_crosshair_row),a
            jr   controls_done
aim_left:   ld   a,(spr_crosshair_col)
            dec  a
            ld   (spr_crosshair_col),a
            xor  0FFh
            jr   nz,controls_done
            ld   a,1Eh
            ld   (spr_crosshair_col),a
            ld   a,(v_scene)
            inc  a
            ld   (v_scene),a
            xor  05h
            call z,scene_first
            call draw_scene
            jr   controls_done
scene_first:ld   a,01h
            ld   (v_scene),a
            ret
aim_right:  ld   a,(spr_crosshair_col)
            inc  a
            ld   (spr_crosshair_col),a
            xor  1Fh
            jr   nz,controls_done
            ld   a,00h
            ld   (spr_crosshair_col),a
            ld   a,(v_scene)
            dec  a
            ld   (v_scene),a
            xor  00h
            call z,scene_last
            call draw_scene
            jp   controls_done
scene_last: ld   a,04h
            ld   (v_scene),a
            ret
; Dibuja la escena: copia el fondo de v_scene (0x1200 bytes: 4096 de bitmap y 512 de atributos) de
; level_body a bg_buffer, coloca los actores y escribe marcadores con la ROM (mismo truco de número flotante).
draw_scene: ld   a,(v_scene)
            ld   hl,4FA8h
            ld   b,a
lbl_ED22:   push bc
            ld   bc,1200h
lbl_ED26:   inc  hl
            dec  bc
            ld   a,b
            or   c
            jr   nz,lbl_ED26
            pop  bc
            djnz lbl_ED22
            ld   de,bg_buffer
            ld   bc,1200h
            ldir
            call place_actors
            ld   a,16h
            rst  10h
            ld   a,14h
            rst  10h
            ld   a,02h
            rst  10h
            ld   a,0DCh
            ld   (ERR_NR_mark),a
            ld   a,30h
            rst  10h
            ld   a,(v_lives)
            call 2D28h
            call 2DE3h
            ld   a,16h
            rst  10h
            ld   a,14h
            rst  10h
            ld   a,07h
            rst  10h
            ld   ix,v_score_top
            ld   b,06h
lbl_ED63:   push bc
            push ix
            ld   a,(ix+00h)
            call 2D28h
            call 2DE3h
            pop  ix
            dec  ix
            pop  bc
            djnz lbl_ED63
            ld   a,16h
            rst  10h
            ld   a,15h
            rst  10h
            ld   a,02h
            rst  10h
            ld   a,0DBh
            ld   (ERR_NR_mark),a
            ld   a,88h
            ld   (CHARS),a
            ld   a,30h
            rst  10h
            ld   a,(v_lives)
            call 2D28h
            call 2DE3h
            ld   a,16h
            rst  10h
            ld   a,15h
            rst  10h
            ld   a,07h
            rst  10h
            ld   ix,v_score_top
            ld   b,06h
lbl_EDA4:   push bc
            push ix
            ld   a,(ix+00h)
            call 2D28h
            call 2DE3h
            pop  ix
            dec  ix
            pop  bc
            djnz lbl_EDA4
            ld   a,00h
            ld   (CHARS),a
            ld   a,3Ch
            ld   (ERR_NR_mark),a
            ret
; Un paso de juego: temporizadores del enemigo, avance, dibujo y llamada al bonus.
game_tick:  ld   a,(v_enemy_on)
            xor  01h
            jr   z,lbl_EDD7
            ld   bc,(v_enemy_timer)
            dec  bc
            ld   (v_enemy_timer),bc
            ld   a,b
            or   c
            call z,enemy_pop_up
lbl_EDD7:   ld   a,(v_enemy_on)
            xor  01h
            jr   nz,lbl_EDFA
            ld   a,(v_scene)
            ld   b,a
            ld   a,(v_enemy_scene)
            xor  b
            call nz,enemy_hidden
            call z,enemy_in_view
            ld   bc,(v_step_timer)
            dec  bc
            ld   (v_step_timer),bc
            ld   a,b
            or   c
            call z,enemy_step
lbl_EDFA:   call draw_frame
            call bonus_timer
            jp   read_controls
enemy_pop_up:ld   a,01h
            ld   (v_enemy_on),a
            call enemy_pick
            ld   a,(dat_EF23)
            ld   ix,enemy_gfx_table
            ld   b,a
lbl_EE13:   inc  ix
            inc  ix
            djnz lbl_EE13
            ld   d,(ix+01h)
            ld   e,(ix+00h)
            ld   (spr_enemy),de
            ld   bc,00FAh
            ld   (v_enemy_timer),bc
            ret
enemy_pick: ld   a,(FRAMES)
            ld   b,a
            ld   a,(5C79h)
            xor  b
            ld   b,03h
            and  b
            inc  a
            ld   (dat_EF23),a
            ld   a,(FRAMES)
            ld   b,0Fh
            and  b
            inc  a
            ld   b,a
            ld   de,spawn_table
lbl_EE45:   inc  de
            inc  de
            inc  de
            djnz lbl_EE45
            ld   a,(de)
            inc  de
            ld   (v_enemy_scene),a
            ld   a,(de)
            inc  de
            ld   (spr_enemy_col),a
            ld   a,(de)
            ld   (spr_enemy_row),a
            ret
enemy_hidden:xor  a
            ld   (spr_enemy_on),a
            ld   a,(v_enemy_on)
            xor  01h
            call z,time_runs
            ret
time_runs:  ld   bc,(v_time)
            dec  bc
            ld   (v_time),bc
            ld   a,b
            or   c
            jp   z,lose_life
            ld   a,(v_enemy_scene)
            ld   b,a
            ld   a,01h
            ld   (spr_enemy2_on),a
            ld   a,(v_scene)
            ret
enemy_in_view:ld   a,01h
            ld   (spr_enemy_on),a
            ld   bc,(v_time)
            dec  bc
            ld   (v_time),bc
            ld   a,b
            or   c
            jp   z,lose_life
            xor  a
            ld   (spr_enemy2_on),a
            ret
enemy_step: ld   de,(spr_enemy)
            ld   b,20h
lbl_EE9F:   inc  de
            djnz lbl_EE9F
            ld   (spr_enemy),de
            ld   bc,0032h
            ld   (v_step_timer),bc
            ret
; Tabla de apariciones: registros de 3 bytes (escena, columna, fila); el juego usa 16 (copiada de lvl_spawns, 90 bytes de la cabecera del nivel).
spawn_table:
 db 01h,00h,09h,04h,0Ah,06h,03h,09h,03h,01h,00h,09h,02h,11h,0Dh,02h
 db 1Dh,04h,03h,00h,0Ah,03h,09h,03h,04h,0Ah,06h,04h,12h,0Bh,01h,00h
 db 09h,01h,09h,09h,01h,00h,09h,01h,09h,09h,01h,17h,08h,02h,1Dh,04h
 db 02h,11h,0Dh,02h,1Dh,04h,03h,00h,0Ah,03h,09h,03h,04h,0Ah,06h,04h
 db 12h,0Bh,01h,00h,09h,01h,09h,09h,01h,00h,09h,01h,09h,09h,01h,17h
 db 08h,02h,1Dh,04h,02h,11h,0Dh,02h,1Dh,04h
; Variables del juego.
; v_scene: escena actual (1–4). v_score: 6 dígitos de la puntuación (el menos significativo
; primero). v_record: récord. v_level: nivel (1–4). v_lives: vidas.
v_scene:
 db 00h
v_pace:
 db 00h,00h
v_time_reload:
 db 00h,00h
v_score:
 db 00h,00h,00h,00h,00h
v_score_top:
 db 00h,00h,00h,00h,00h,00h,00h
v_record:
 db 03h,00h
v_time:
 db 00h,00h
v_level:
 db 00h
v_wave:
 db 00h
v_enemy_timer:
 db 00h,00h
v_enemy_on:
 db 00h
v_enemy_scene:
 db 00h
dat_EF23:
 db 00h
v_lives:
 db 00h,00h
dat_EF26:
 db 3Ch
dat_EF27:
 db 00h
v_step_timer:
 db 00h,00h
dat_EF2A:
 db 00h
; Compone un fotograma: dibuja los 7 sprites en bg_buffer (guarda fondo, AND con máscara, OR con gráfico),
; vuelca bg_buffer a la pantalla (4096 bytes) y a los atributos (512), y restaura el fondo bajo cada sprite.
draw_frame: ld   a,(v_enemy_on)
            xor  01h
            jr   z,lbl_EF36
            xor  a
            ld   (spr_enemy_on),a
lbl_EF36:   ld   ix,spr_enemy
            call sprite_draw
            ld   ix,spr_enemy2
            call sprite_draw
            ld   ix,spr_actor1
            call sprite_draw
            ld   ix,spr_actor2
            call sprite_draw
            ld   ix,spr_bonus
            call sprite_draw
            ld   ix,spr_crosshair
            call sprite_draw
            ld   ix,spr_blast
            call sprite_draw
            ld   hl,bg_buffer
            ld   de,4000h
            ld   bc,1000h
            ldir
            ld   hl,bg_attrs
            ld   de,5800h
            ld   bc,0200h
            ldir
            ld   ix,spr_crosshair
            call sprite_restore
            ld   ix,spr_bonus
            call sprite_restore
            ld   ix,spr_actor2
            call sprite_restore
            ld   ix,spr_actor1
            call sprite_restore
            ld   ix,spr_enemy2
            call sprite_restore
            ld   ix,spr_enemy
            call sprite_restore
            ret
; Dibuja un sprite de celdas 8×8 sobre bg_buffer. IX apunta a su estructura:
;   +0 gráfico, +2 máscara, +4 buffer donde guarda el fondo (punteros), +6 columna, +7 fila,
;   +8 ancho y +9 alto en celdas, +10 activo. Las celdas se guardan por columnas, 8 bytes por celda.
sprite_draw:ld   a,(ix+0Ah)
            xor  01h
            ret  nz
            push ix
            ld   e,(ix+04h)
            ld   d,(ix+05h)
            ld   b,(ix+07h)
            ld   c,(ix+06h)
            ld   a,(ix+08h)
lbl_EFBF:   push af
            ld   a,(ix+09h)
lbl_EFC3:   push af
            ld   h,0AAh
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
lbl_EFD6:   ld   a,(hl)
            ld   (de),a
            inc  de
            inc  h
            djnz lbl_EFD6
            pop  bc
            pop  af
            inc  b
            dec  a
            jr   nz,lbl_EFC3
            pop  af
            ld   b,(ix+07h)
            inc  c
            dec  a
            jr   nz,lbl_EFBF
            pop  ix
            push ix
            ld   e,(ix+02h)
            ld   d,(ix+03h)
            ld   b,(ix+07h)
            ld   c,(ix+06h)
            ld   a,(ix+08h)
lbl_EFFD:   push af
            ld   a,(ix+09h)
lbl_F001:   push af
            ld   h,0AAh
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
lbl_F014:   ld   a,(de)
            and  (hl)
            ld   (hl),a
            inc  de
            inc  h
            djnz lbl_F014
            pop  bc
            pop  af
            inc  b
            dec  a
            jr   nz,lbl_F001
            pop  af
            ld   b,(ix+07h)
            inc  c
            dec  a
            jr   nz,lbl_EFFD
            pop  ix
            ld   e,(ix+00h)
            ld   d,(ix+01h)
            ld   b,(ix+07h)
            ld   c,(ix+06h)
            ld   a,(ix+08h)
lbl_F03A:   push af
            ld   a,(ix+09h)
lbl_F03E:   push af
            ld   h,0AAh
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
lbl_F051:   ld   a,(de)
            or   (hl)
            ld   (hl),a
            inc  de
            inc  h
            djnz lbl_F051
            pop  bc
            pop  af
            inc  b
            dec  a
            jr   nz,lbl_F03E
            pop  af
            ld   b,(ix+07h)
            inc  c
            dec  a
            jr   nz,lbl_F03A
            ret
; Restaura el fondo guardado bajo un sprite (inversa de sprite_draw).
sprite_restore:ld   a,(ix+0Ah)
            xor  01h
            ret  nz
            ld   e,(ix+04h)
            ld   d,(ix+05h)
            ld   b,(ix+07h)
            ld   c,(ix+06h)
            ld   a,(ix+08h)
lbl_F07C:   push af
            ld   a,(ix+09h)
lbl_F080:   push af
            ld   h,0AAh
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
lbl_F093:   ld   a,(de)
            ld   (hl),a
            inc  de
            inc  h
            djnz lbl_F093
            pop  bc
            pop  af
            inc  b
            dec  a
            jr   nz,lbl_F080
            pop  af
            ld   b,(ix+07h)
            inc  c
            dec  a
            jr   nz,lbl_F07C
            ret
; Estructuras de sprite (ver sprite_draw): mira, enemigo, segundo enemigo, destello, dos actores y bonus.
spr_crosshair:
 dw ending_code
 dw 0C3B4h
 dw 0C418h
spr_crosshair_col:
 db 0Ah
spr_crosshair_row:
 db 0Ah,02h,02h
spr_crosshair_on:
 db 01h
spr_enemy:
 dw 0C998h
 dw 0C4E0h
 dw 0C544h
spr_enemy_col:
 db 0Bh
spr_enemy_row:
 db 0Ah,02h,02h
spr_enemy_on:
 db 00h
spr_enemy2:
 dw 0C9B8h
 dw 0C9D8h
 dw 0C4E0h
 db 0Fh,02h,02h,02h
spr_enemy2_on:
 db 01h
spr_blast:
 dw 0C9F8h
 dw 0CA18h
 dw rom_start
dat_F0CF:
 db 00h
dat_F0D0:
 db 00h,02h,02h
dat_F0D3:
 db 00h
spr_actor1:
 dw rom_start
dat_F0D6:
 db 00h,00h,0Ch,0C6h
dat_F0DA:
 db 00h
dat_F0DB:
 db 00h,02h,02h
dat_F0DE:
 db 00h
spr_actor2:
 dw rom_start
dat_F0E1:
 db 00h,00h,0A8h,0C5h
dat_F0E5:
 db 00h
dat_F0E6:
 db 00h,02h,02h
dat_F0E9:
 db 00h
spr_bonus:
 dw 0C670h
 dw 0C690h
 dw 0C6B0h
spr_bonus_col:
 db 1Dh
dat_F0F1:
 db 0Ch,02h,02h
bonus_active:
 db 00h
; Pierde una vida: sonido, parpadeo y, si no quedan, game_over.
lose_life:  ld   hl,ay_silence
            call ay_play
            ld   a,(v_enemy_scene)
            ld   (v_scene),a
            call draw_scene
            xor  a
            ld   (spr_enemy2_on),a
            ld   (spr_crosshair_on),a
            inc  a
            ld   (spr_enemy_on),a
            call draw_frame
            ld   a,01h
            ld   (dat_F0D3),a
            ld   b,05h
lbl_F119:   push bc
            ld   bc,rom_start
lbl_F11D:   dec  bc
            ld   a,b
            or   c
            jr   nz,lbl_F11D
            ld   hl,ay_silence
            call ay_play
            ld   a,(FRAMES)
            and  1Fh
            ld   (dat_F0CF),a
            ld   a,(FRAMES)
            ld   b,a
            ld   a,(5C79h)
            xor  b
            and  0Fh
            dec  a
            ld   (dat_F0D0),a
            call draw_frame
            pop  bc
            djnz lbl_F119
            xor  a
            ld   (dat_F0D3),a
            ld   bc,88B8h
lbl_F14B:   dec  bc
            push bc
            ld   b,32h
lbl_F14F:   djnz lbl_F14F
            pop  bc
            ld   a,b
            or   c
            jr   nz,lbl_F14B
            ld   bc,0200h
            ld   hl,5800h
lbl_F15C:   xor  a
            ld   (hl),a
            inc  hl
            dec  bc
            ld   a,b
            or   c
            jr   nz,lbl_F15C
            ld   bc,rom_start
lbl_F167:   dec  bc
            ld   a,b
            or   c
            jr   nz,lbl_F167
            ld   a,(v_lives)
            dec  a
            ld   (v_lives),a
            jp   z,game_over
            ld   a,01h
            ld   (spr_crosshair_on),a
            xor  a
            ld   (v_enemy_on),a
            ld   bc,00FAh
            ld   (v_time),bc
            ld   (v_enemy_timer),bc
            xor  a
            ld   (spr_enemy_on),a
            ld   (spr_enemy2_on),a
            ld   bc,00FAh
            ld   (v_time_reload),bc
            ld   bc,0032h
            ld   (v_step_timer),bc
            ld   (v_pace),bc
            call draw_scene
            ret
enemy_gfx_table:
 dw 0C738h
 dw 0C738h
 dw 0C7D8h
 dw 0C878h
 dw 0C918h
; Sonidos: 14 valores para los registros 0–13 del AY-3-8912 (el juego usa un AY: puertos FFFDh/BFFDh).
ay_silence:
 db 00h,00h,00h,00h,00h,00h,1Eh,40h,10h,10h,10h,00h,07h,00h
ay_fx_miss:
 db 67h,00h,49h,00h,45h,00h,00h,0F8h,10h,10h,10h,00h,10h,00h
ay_fx_hit:
 db 00h,00h,00h,00h,00h,11h,1Fh,40h,10h,10h,10h,00h,08h,06h
ay_fx_actor:
 db 65h,00h,42h,00h,3Ch,00h,00h,0F0h,10h,10h,10h,00h,10h,00h
; Escribe 14 valores (HL) en los registros del AY y reproduce una muestra por el altavoz (play_sample).
ay_play:    ld   b,0Eh
            ld   e,00h
lbl_F1ED:   push bc
            ld   bc,0FFFDh
            ld   a,e
            out  (c),a
            ld   a,(hl)
            ld   bc,0BFFDh
            out  (c),a
            inc  hl
            inc  e
            pop  bc
            djnz lbl_F1ED
            call play_sample
            ret
; Disparo: sonido y comprobación de si la mira está sobre un actor o enemigo.
fire:       ld   hl,ay_silence
            call ay_play
            call check_actors
            call bonus_check
            ld   a,(spr_enemy2_on)
            xor  01h
            jr   nz,lbl_F22A
            ld   a,(spr_crosshair_col)
            xor  0Fh
            jr   nz,lbl_F22A
            ld   a,(spr_crosshair_row)
            xor  02h
            jr   nz,lbl_F22A
            ld   hl,ay_fx_miss
            call ay_play
lbl_F22A:   ld   a,(spr_enemy_on)
            xor  01h
            jp   nz,controls_done
            ld   a,(spr_enemy_row)
            ld   b,a
            ld   a,(spr_crosshair_row)
            xor  b
            jp   nz,controls_done
            ld   a,(spr_enemy_col)
            ld   b,a
            ld   a,(spr_crosshair_col)
            xor  b
            jp   nz,controls_done
            ld   a,(v_enemy_scene)
            ld   b,a
            ld   a,(v_scene)
            jp   nz,controls_done
            ld   hl,ay_fx_hit
            push ix
            ld   ix,v_score
            inc  (ix+02h)
            call score_carry
            pop  ix
            call ay_play
            ld   bc,(v_pace)
            ld   de,001Ah
            ld   a,c
            xor  e
            jr   nz,lbl_F276
            ld   a,b
            xor  d
            jp   z,begin_scene
lbl_F276:   ld   hl,(v_time_reload)
            ld   b,14h
lbl_F27B:   dec  hl
            djnz lbl_F27B
            ld   (v_time_reload),hl
            ld   hl,(v_pace)
            dec  hl
            dec  hl
            dec  hl
            dec  hl
            ld   (v_step_timer),hl
            ld   (v_pace),hl
            jp   begin_scene
; Coloca los actores de la escena actual desde actor_table (10 entradas de 8 bytes: escena, columna, fila,
; tipo, puntero al gráfico y a la máscara).
place_actors:ld   b,0Ah
            ld   ix,actor_table
            xor  a
            ld   (dat_F0DE),a
            ld   (dat_F0E9),a
lbl_F29E:   push bc
            ld   a,(v_scene)
            ld   b,(ix+00h)
            xor  b
            call z,place_actor
            inc  ix
            inc  ix
            inc  ix
            inc  ix
            inc  ix
            inc  ix
            inc  ix
            inc  ix
            pop  bc
            djnz lbl_F29E
            ret
place_actor:ld   a,(ix+03h)
            xor  01h
            jr   nz,lbl_F2EA
            ld   a,(ix+01h)
            ld   (dat_F0DB),a
            ld   a,(ix+02h)
            ld   (dat_F0DA),a
            ld   c,(ix+04h)
            ld   b,(ix+05h)
            ld   (spr_actor1),bc
            ld   c,(ix+06h)
            ld   b,(ix+07h)
            ld   (dat_F0D6),bc
            ld   a,01h
            ld   (dat_F0DE),a
            ret
lbl_F2EA:   ld   a,(ix+01h)
            ld   (dat_F0E6),a
            ld   a,(ix+02h)
            ld   (dat_F0E5),a
            ld   c,(ix+04h)
            ld   b,(ix+05h)
            ld   (spr_actor2),bc
            ld   c,(ix+06h)
            ld   b,(ix+07h)
            ld   (dat_F0E1),bc
            ld   a,01h
            ld   (dat_F0E9),a
            ret
; Tabla de actores (copiada de lvl_actors al empezar el nivel).
actor_table:
 db 01h,0Ch,0Ah,01h,38h,0CAh,58h,0CAh,01h,0Eh,1Ah,02h,78h,0CAh,98h,0CAh
 db 02h,0Eh,16h,01h,38h,0CBh,58h,0CBh,02h,0Eh,06h,02h,38h,0CAh,58h,0CAh
 db 03h,03h,0Bh,01h,38h,0CAh,58h,0CAh,03h,09h,18h,02h,0F8h,0CAh,18h,0CBh
 db 04h,0Eh,13h,01h,0B8h,0CAh,0D8h,0CAh,04h,04h,03h,02h,38h,0CAh,58h,0CAh
check_actors:ld   b,0Ah
            ld   ix,actor_table
lbl_F356:   push bc
            ld   b,(ix+00h)
            ld   a,(v_scene)
            xor  b
            jr   nz,lbl_F393
            ld   b,(ix+01h)
            ld   a,(spr_crosshair_row)
            xor  b
            jr   nz,lbl_F393
            ld   b,(ix+02h)
            ld   a,(spr_crosshair_col)
            xor  b
            jr   nz,lbl_F393
            ld   a,05h
            ld   (ix+00h),a
            ld   hl,ay_fx_actor
            call ay_play
            push ix
            ld   ix,v_score
            ld   a,(ix+01h)
            inc  a
            inc  a
            inc  a
            inc  a
            inc  a
            ld   (ix+01h),a
            call score_carry
            pop  ix
lbl_F393:   inc  ix
            inc  ix
            inc  ix
            inc  ix
            inc  ix
            inc  ix
            inc  ix
            inc  ix
            pop  bc
            djnz lbl_F356
            call draw_scene
            ret
; Propaga el acarreo entre los dígitos de la puntuación (un dígito pasa de 9 a 0 y suma al siguiente).
score_carry:ld   ix,v_score_top
            ld   b,05h
lbl_F3B0:   push bc
            ld   a,(ix+00h)
            xor  0Ah
            jr   nz,lbl_F3BF
            ld   (ix+00h),00h
            inc  (ix+01h)
lbl_F3BF:   dec  ix
            pop  bc
            djnz lbl_F3B0
            ret
bonus_timer:ld   a,(bonus_active)
            xor  01h
            jr   z,lbl_F3E4
            ld   a,(FRAMES)
            ld   b,a
            ld   a,r
            xor  b
            ld   b,a
            ld   a,0Ah
            xor  b
            ret  nz
            xor  a
            inc  a
            ld   (bonus_active),a
            ld   a,(v_scene)
            ld   (dat_EF2A),a
            ret
lbl_F3E4:   ld   a,(spr_bonus_col)
            dec  a
            ld   (spr_bonus_col),a
            ld   a,0Ch
            ld   (dat_F0F1),a
            ld   a,(spr_bonus_col)
            xor  01h
            ret  nz
            xor  a
            ld   (bonus_active),a
            ld   a,1Dh
            ld   (spr_bonus_col),a
            ret
bonus_check:ld   a,(bonus_active)
            xor  00h
            ret  z
            ld   a,(spr_crosshair_row)
            xor  0Ch
            ret  nz
            ld   a,(spr_crosshair_col)
            ld   b,a
            ld   a,(spr_bonus_col)
            xor  b
            ret  nz
            ld   hl,ay_fx_miss
            call ay_play
            ld   ix,v_score
            ld   a,(ix+02h)
            inc  a
            ld   (ix+02h),a
            xor  a
            ld   (bonus_active),a
            call score_carry
            ret
; Fin de la partida.
game_over:  ld   de,txt_game_over
            ld   bc,001Eh
            ld   a,0DCh
            ld   (ERR_NR_mark),a
            call rom_print_str
            ld   a,(v_level)
            xor  01h
            jp   z,ask_space
            jp   ask_rewind_side
txt_game_over:
 db 16h,0Ah,0Bh,10h,01h,11h,00h,"GAME OVER",16h,0Bh,0Bh,10h
 db 03h,"game over"
txt_press_space:
 db 16h,06h,02h,10h,01h,11h,00h," PULSE ESPACE PARA EMPEZAR ",16h,07h,02h,10h
 db 03h," pulse espace para empezar"
 db 20h
txt_rewind:
 db 16h,02h,00h,10h,02h,11h,00h,"REBOBINA LA CARA B Y PULSA PLAY",16h,03h,00h,10h
 db 03h,"rebobina la cara b y pulsa play  "
 db 20h,3Eh,02h,0CDh,01h,16h
load_error: ld   de,txt_error
            ld   hl,5800h
            ld   bc,0300h
lbl_F502:   xor  00h
            rlc  (hl)
            inc  hl
            dec  bc
            ld   a,b
            or   c
            jr   nz,lbl_F502
            ld   (hl),a
            ld   bc,0016h
            ld   a,0DCh
            ld   (ERR_NR_mark),a
            call rom_print_str
            ret
txt_error:
 db 16h,0Ah,0Dh,10h,03h,11h,00h,45h,52h,52h,4Fh,52h,16h,0Bh,0Dh,10h
 db 02h,65h,72h,72h,6Fh,72h,20h,20h,20h,20h,20h,20h,3Eh,02h,0CDh,01h
 db 16h
; Pasa al nivel siguiente: pide cargar su cabecera y su cuerpo de la cinta. Tras el cuarto, carga el final.
next_level: ld   a,(v_level)
            inc  a
            ld   (v_level),a
            xor  05h
            jp   z,load_ending
            xor  a
            dec  a
            ld   (v_wave),a
            ld   a,(v_level)
            ld   b,21h
            add  a,b
            ld   (txt_level_digit2),a
            ld   a,(v_level)
            ld   b,30h
            add  a,b
            ld   (txt_level_digit),a
            ld   de,txt_level
            ld   bc,004Ah
            ld   a,0DCh
            ld   (ERR_NR_mark),a
            call rom_print_str
lbl_F56B:   ld   a,0BFh
            in   a,(0FEh)
            bit  0,a
            jr   nz,lbl_F56B
lbl_F573:   ld   ix,level_header
            ld   de,04C6h
            ld   a,(v_level)
            scf
            call rom_ld_bytes
            call nc,load_error
            jp   nc,lbl_F573
            ld   ix,level_body
            ld   de,4800h
            ld   a,(v_level)
            inc  a
            inc  a
            inc  a
            inc  a
            scf
            call rom_ld_bytes
            call nc,load_error
            jr   nc,lbl_F573
            ld   de,txt_press_space
            ld   bc,0041h
            ld   a,0DCh
            ld   (ERR_NR_mark),a
            call rom_print_str
            xor  a
            out  (0FEh),a
lbl_F5AF:   ld   a,7Fh
            in   a,(0FEh)
            bit  0,a
            jr   nz,lbl_F5AF
            xor  a
            out  (0FEh),a
            ld   a,(v_lives)
            inc  a
            ld   (v_lives),a
            jp   begin_level
txt_level:
 db 16h,00h,0Ch,10h,01h,11h,00h,"FASE "
txt_level_digit:
 db 00h,16h,01h,0Ch,10h,03h,11h,00h,66h,61h,73h,65h,20h
txt_level_digit2:
 db 00h,16h,0Ah,06h,10h,03h,11h,00h,50h,55h,4Ch,53h,41h,20h,45h,4Eh
 db 54h,45h,52h,20h,59h,20h,50h,4Ch,41h,59h,16h,0Bh,06h,10h,05h,70h
 db 75h,6Ch,73h,61h,20h,65h,6Eh,74h,65h,72h,20h,79h,20h,70h,6Ch,61h
 db 79h
; Carga el bloque final de la cinta (3292 bytes en C350h) y salta a su entrada (ending_entry).
load_ending:ld   ix,ending_code
            ld   de,0CDCh
            ld   a,0FFh
            scf
            call rom_ld_bytes
            jp   ending_entry
; Reproduce 768 bytes de memoria (sample_data) como pulsos por el altavoz (bit 4 del puerto FEh).
play_sample:ld   hl,sample_data
            ld   bc,0300h
            ld   a,(BORDCR)
            sra  a
            sra  a
            sra  a
            and  07h
            ld   d,a
lbl_F630:   ld   e,(hl)
            inc  e
            inc  hl
            dec  bc
            push bc
            ld   b,08h
lbl_F637:   ld   a,e
            and  10h
            rl   e
            or   d
            out  (0FEh),a
            djnz lbl_F637
            pop  bc
            ld   a,c
            or   b
            jr   nz,lbl_F630
            xor  a
            out  (0FEh),a
            ret
; Desde aquí hasta el final del bloque son datos de relleno que ya estaban en la memoria al grabar la cinta
; (un volcado de memoria con restos de BASIC y de la fuente); sample_data usa los primeros 768 bytes.
sample_data:
 db 0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh
 ds 2241
 db 0CEh,0Bh,0FBh,50h,06h,17h,0DCh,0Ah,0D7h,18h,38h,00h,0B1h,33h,82h,5Dh
 db 05h,00h,0CEh,0Bh,0FAh,50h,07h,17h,0DBh,02h,0DBh,02h,7Ch,38h,0D4h,03h
 db 4Dh,00h,0DAh,56h,26h,00h,0D9h,56h,0Ch,02h,84h,08h,0C0h,57h,0C0h,57h
 db 22h,3Ah,1Bh,00h,2Ah,12h,0B3h,5Fh,3Dh,10h,3Ah,5Bh,00h,3Eh,0B5h,3Eh
 db 0B0h,0Dh,00h,3Ch,42h,42h,7Eh,42h,42h,00h,00h,7Ch,42h,7Ch,42h,42h
 db 7Ch,00h,00h,3Ch,42h,40h,40h,42h,3Ch,00h,00h,78h,44h,42h,42h,44h
 db 78h,00h,05h,7Eh,40h,7Ch,40h,40h,7Eh,00h,00h,7Eh,40h,7Ch,40h,40h
 db 40h,00h,00h,3Ch,42h,40h,4Eh,42h,3Ch,00h,00h,42h,42h,7Eh,42h,42h
 db 42h,00h,00h,3Eh,08h,08h,08h,08h,3Eh,00h,00h,02h,02h,02h,42h,42h
 db 3Ch,00h,00h,44h,48h,70h,48h,44h,42h,00h,00h,40h,40h,40h,40h,40h
 db 7Eh,00h,00h,42h,66h,5Ah,42h,42h,42h,00h,00h,42h,62h,52h,4Ah,46h
 db 42h,00h,00h,3Ch,42h,42h,42h,42h,3Ch,00h,00h,7Ch,42h,42h,7Ch,40h
 db 40h,00h,00h,3Ch,42h,42h,52h,4Ah,3Ch,00h,00h,7Ch,42h,42h,7Ch,44h
 db 42h,00h,00h,3Ch,40h,3Ch,02h,42h,3Ch,00h,00h,0FEh,10h,10h,10h,10h
 db 10h,00h,00h,42h
