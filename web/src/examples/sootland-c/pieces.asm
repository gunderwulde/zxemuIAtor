; Recursos del motor de Sootland (versión en C): las tres piezas que el stub de carga reparte con LDIR
; desde el bloque cargado en D778h. PHASE da a cada pieza la dirección a la que se copia. Terminan
; justo en EA60h, donde empieza el código en C (engine.c).
 org 0D778h

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

; Pieza 3 → C350h: celdas de 8×8 de los sprites comunes (gráficos y máscaras).
 phase 0C350h
sprites:
 incbin "sprites.tiles"
 dephase
