; Sootland — nivel 4
; Cabecera (flag 4) y cuerpo (flag 8) que el motor carga con LD-BYTES al empezar el nivel.
; © 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso.
; Gráficos: Alberto Herraiz y Fernando Pérez. Música: J. Torres.
; Reconstruido por ingeniería inversa de la cinta original e incluido con permiso de su autor.

; Cabecera: 1222 bytes en CA38h.
 org 0CA38h
level_header:
; 129 celdas de 8×8 con los sprites de este nivel (enemigos y actores, con sus máscaras).
 incbin "lvl4.tiles"

; Actores: 8 entradas de 8 bytes (escena, columna, fila, tipo, puntero al gráfico, puntero a la máscara).
lvl_actors:
 db 000h,000h,000h,000h
 dw 00000h,00000h
 db 000h,000h,000h,000h
 dw 00000h,00000h
 db 000h,000h,000h,000h
 dw 00000h,00000h
 db 000h,000h,000h,000h
 dw 00000h,00000h
 db 000h,000h,000h,000h
 dw 00000h,00000h
 db 000h,000h,000h,000h
 dw 00000h,00000h
 db 000h,000h,000h,000h
 dw 00000h,00000h
 db 000h,000h,000h,000h
 dw 00000h,00000h

; Sin usar.
 ds 36

; Apariciones de enemigos: registros de 3 bytes (escena, columna, fila); el juego usa 16.
lvl_spawns:
 db 001h,018h,006h,001h,01Eh,006h
 db 004h,01Ch,009h,004h,003h,006h
 db 003h,00Fh,009h,003h,01Eh,009h
 db 002h,000h,009h,002h,004h,009h
 db 001h,018h,006h,001h,01Eh,006h
 db 004h,01Ch,009h,004h,003h,006h
 db 003h,00Fh,009h,003h,01Eh,009h
 db 002h,000h,009h,002h,004h,009h
 db 001h,018h,006h,001h,01Eh,006h
 db 004h,01Ch,009h,004h,003h,006h
 db 003h,00Fh,009h,003h,01Eh,009h
 db 002h,000h,009h,002h,004h,009h
 db 001h,018h,006h,001h,01Eh,006h
 db 004h,01Ch,009h,004h,003h,006h
 db 003h,00Fh,009h,003h,01Eh,009h

; Cuerpo: 18432 bytes en 61A8h = 4 fondos de 4608 (128 líneas de bitmap + 16 filas de atributos), uno por escena.
 org 61A8h
level_body:
bg1:
 incbin "l4a.scr#top"
bg2:
 incbin "l4b.scr#top"
bg3:
 incbin "l4c.scr#top"
bg4:
 incbin "l4d.scr#top"
