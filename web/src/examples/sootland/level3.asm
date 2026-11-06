; Sootland — nivel 3
; Cabecera (flag 3) y cuerpo (flag 7) que el motor carga con LD-BYTES al empezar el nivel.
; © 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso.
; Gráficos: Alberto Herraiz y Fernando Pérez. Música: J. Torres.
; Reconstruido por ingeniería inversa de la cinta original e incluido con permiso de su autor.

; Cabecera: 1222 bytes en CA38h.
 org 0CA38h
level_header:
; 129 celdas de 8×8 con los sprites de este nivel (enemigos y actores, con sus máscaras).
 incbin "lvl3.tiles"

; Actores: 8 entradas de 8 bytes (escena, columna, fila, tipo, puntero al gráfico, puntero a la máscara).
lvl_actors:
 db 001h,00Ah,001h,001h
 dw level_header,level_header+00020h
 db 001h,007h,011h,002h
 dw level_header+00040h,level_header+00060h
 db 002h,008h,004h,001h
 dw level_header+00080h,level_header+000A0h
 db 002h,00Eh,013h,002h
 dw level_header+000C0h,level_header+000E0h
 db 003h,007h,015h,001h
 dw level_header+00100h,level_header+00120h
 db 003h,007h,015h,001h
 dw level_header+00100h,level_header+00120h
 db 004h,00Eh,01Dh,001h
 dw level_header+000C0h,level_header+000E0h
 db 004h,008h,004h,002h
 dw level_header+00080h,level_header+000A0h

; Sin usar.
 ds 36

; Apariciones de enemigos: registros de 3 bytes (escena, columna, fila); el juego usa 16.
lvl_spawns:
 db 001h,011h,003h,001h,011h,003h
 db 002h,005h,003h,003h,005h,007h
 db 004h,00Fh,008h,001h,005h,001h
 db 004h,00Fh,008h,001h,005h,001h
 db 003h,010h,002h,001h,011h,003h
 db 003h,010h,002h,001h,004h,00Fh
 db 002h,011h,003h,002h,011h,003h
 db 003h,005h,007h,002h,011h,003h
 db 003h,010h,002h,001h,004h,00Fh
 db 003h,010h,002h,001h,011h,003h
 db 003h,005h,007h,001h,005h,001h
 db 004h,007h,003h,001h,005h,001h
 db 003h,005h,007h,001h,004h,00Fh
 db 002h,011h,003h,001h,004h,007h
 db 004h,00Fh,008h,001h,011h,003h

; Cuerpo: 18432 bytes en 61A8h = 4 fondos de 4608 (128 líneas de bitmap + 16 filas de atributos), uno por escena.
 org 61A8h
level_body:
bg1:
 incbin "l3a.scr#top"
bg2:
 incbin "l3b.scr#top"
bg3:
 incbin "l3c.scr#top"
bg4:
 incbin "l3d.scr#top"
