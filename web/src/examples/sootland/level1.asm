; Sootland — nivel 1
; Cabecera (flag 1) y cuerpo (flag 5) que el motor carga con LD-BYTES al empezar el nivel.
; © 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso.
; Gráficos: Alberto Herraiz y Fernando Pérez. Música: J. Torres.
; Reconstruido por ingeniería inversa de la cinta original e incluido con permiso de su autor.

; Cabecera: 1222 bytes en CA38h.
 org 0CA38h
level_header:
; 129 celdas de 8×8 con los sprites de este nivel (enemigos y actores, con sus máscaras).
 incbin "lvl1.tiles"

; Actores: 8 entradas de 8 bytes (escena, columna, fila, tipo, puntero al gráfico, puntero a la máscara).
lvl_actors:
 db 001h,00Ch,00Ah,001h
 dw level_header,level_header+00020h
 db 001h,00Eh,01Ah,002h
 dw level_header+00040h,level_header+00060h
 db 002h,00Eh,016h,001h
 dw level_header+00100h,level_header+00120h
 db 002h,00Eh,006h,002h
 dw level_header,level_header+00020h
 db 003h,003h,00Bh,001h
 dw level_header,level_header+00020h
 db 003h,009h,018h,002h
 dw level_header+000C0h,level_header+000E0h
 db 004h,00Eh,013h,001h
 dw level_header+00080h,level_header+000A0h
 db 004h,004h,003h,002h
 dw level_header,level_header+00020h

; Sin usar.
 ds 36

; Apariciones de enemigos: registros de 3 bytes (escena, columna, fila); el juego usa 16.
lvl_spawns:
 db 001h,000h,009h,004h,00Ah,006h
 db 003h,009h,003h,001h,000h,009h
 db 002h,011h,00Dh,002h,01Dh,004h
 db 003h,000h,00Ah,003h,009h,003h
 db 004h,00Ah,006h,004h,012h,00Bh
 db 001h,000h,009h,001h,009h,009h
 db 001h,000h,009h,001h,009h,009h
 db 001h,017h,008h,002h,01Dh,004h
 db 002h,011h,00Dh,002h,01Dh,004h
 db 003h,000h,00Ah,003h,009h,003h
 db 004h,00Ah,006h,004h,012h,00Bh
 db 001h,000h,009h,001h,009h,009h
 db 001h,000h,009h,001h,009h,009h
 db 001h,017h,008h,002h,01Dh,004h
 db 002h,011h,00Dh,002h,01Dh,004h

; Cuerpo: 18432 bytes en 61A8h = 4 fondos de 4608 (128 líneas de bitmap + 16 filas de atributos), uno por escena.
 org 61A8h
level_body:
bg1:
 incbin "l1a.scr#top"
bg2:
 incbin "l1b.scr#top"
bg3:
 incbin "l1c.scr#top"
bg4:
 incbin "l1d.scr#top"
