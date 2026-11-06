; Sootland — nivel 2
; Cabecera (flag 2) y cuerpo (flag 6) que el motor carga con LD-BYTES al empezar el nivel.
; © 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso.
; Gráficos: Alberto Herraiz y Fernando Pérez. Música: J. Torres.
; Reconstruido por ingeniería inversa de la cinta original e incluido con permiso de su autor.

; Cabecera: 1222 bytes en CA38h.
 org 0CA38h
level_header:
; 129 celdas de 8×8 con los sprites de este nivel (enemigos y actores, con sus máscaras).
 incbin "lvl2.tiles"

; Actores: 8 entradas de 8 bytes (escena, columna, fila, tipo, puntero al gráfico, puntero a la máscara).
lvl_actors:
 db 001h,004h,00Ah,001h
 dw level_header,level_header+00020h
 db 001h,009h,003h,002h
 dw level_header+00100h,level_header+00120h
 db 002h,004h,002h,001h
 dw level_header,level_header+00020h
 db 002h,00Eh,01Dh,002h
 dw level_header+00040h,level_header+00060h
 db 003h,003h,008h,001h
 dw level_header+000C0h,level_header+000E0h
 db 003h,005h,01Ah,002h
 dw level_header,level_header+00020h
 db 004h,00Ah,00Fh,001h
 dw level_header+00080h,level_header+000A0h
 db 004h,005h,006h,002h
 dw level_header,level_header+00020h

; Sin usar.
 ds 36

; Apariciones de enemigos: 15 entradas de 6 bytes.
lvl_spawns:
 db 001h,017h,007h,001h,017h,007h
 db 002h,018h,007h,003h,005h,00Eh
 db 004h,00Eh,007h,001h,006h,007h
 db 004h,00Eh,007h,001h,006h,007h
 db 003h,002h,008h,001h,017h,007h
 db 003h,002h,008h,003h,002h,008h
 db 003h,002h,008h,003h,002h,008h
 db 003h,005h,00Eh,002h,003h,008h
 db 003h,002h,008h,003h,002h,008h
 db 003h,002h,008h,001h,017h,007h
 db 003h,005h,00Eh,001h,006h,007h
 db 004h,01Dh,007h,001h,006h,007h
 db 003h,005h,00Eh,003h,002h,008h
 db 002h,003h,008h,002h,003h,008h
 db 004h,00Eh,007h,001h,017h,007h

; Cuerpo: 18432 bytes en 61A8h = 4 fondos de 4608 (128 líneas de bitmap + 16 filas de atributos), uno por escena.
 org 61A8h
level_body:
bg1:
 incbin "l2a.scr#top"
bg2:
 incbin "l2b.scr#top"
bg3:
 incbin "l2c.scr#top"
bg4:
 incbin "l2d.scr#top"
