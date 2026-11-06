# Recursos del IDE (editores visuales)

Los recursos son pestañas del editor, junto a los `.asm`/`.c`/`.h`, cuyo documento es JSON
y se edita con un editor visual. Para el código son **ficheros binarios**: el ensamblador
los incluye con `INCBIN "nombre.ext"`. El binario sale de una función pura sobre el
texto de la pestaña (`ResourceKind.toBin`), así que no hay `.bin` en disco que mantener.
Sirve igual desde un `.c` (el ensamblador generado lleva el `INCBIN`).

Código: `web/src/res/` (TS puro: registro, formatos y conversiones) y `web/src/ui/res/`
(editores visuales). Tests: `tests/res/`, `tests/ui/tabs/resources.test.ts`.

## `.scr` — pantalla (SCREEN$)

6912 bytes: 6144 de bitmap en el orden de la ULA (tercios; `bitmapOffset(x, y)`) y 768
de atributos (`FLASH|BRIGHT|PAPER<<3|INK`). Es el formato de `SCREEN$` y de `LOAD "" SCREEN$`.
Documento: `{"v":1,"scr":"<base64 de los 6912 bytes>"}`.

Importar una imagen (PNG, JPG, GIF…) la convierte así:

1. Se encaja en 256×192: ajustar con barras negras, rellenar recortando o estirar. La
   transparencia se compone sobre negro.
2. Cada celda de 8×8 admite dos colores y un brillo común. Se prueban los 128 pares
   (brillo, papel, tinta) y gana el de menor error (distancia RGB ponderada 3·4·2). A
   igualdad, el de menos píxeles de tinta y luego el primero en orden: brillo, papel,
   tinta. Por eso una celda lisa queda toda en papel.
3. Cada píxel va a tinta o papel por proximidad, o con tramado ordenado 4×4 (Bayer)
   sobre la proyección en la recta papel→tinta.

La paleta es la del núcleo (`core/src/video.c`): 0xD7 normal y 0xFF con brillo.
La imagen original se conserva mientras la pestaña está abierta, para reconvertir al
cambiar las opciones; se guarda sólo la pantalla convertida. También se importa y exporta
un `.scr` crudo.

Uso típico: pantalla de carga o de título. Cargarla en la pantalla desde el código:

```asm
        ld hl, titulo
        ld de, 4000h
        ld bc, 6912
        ldir
        ...
titulo: incbin "titulo.scr"
```

(Para cargarla desde la cinta antes del juego hace falta un bloque aparte; el exportador
de TAP todavía no lo genera.)

## `.tiles` — conjunto de tiles

Tiles de 8×8 o de 16×16 (se elige al crear el conjunto; hasta 256). Cada tile lleva dibujo,
color por cuadro de 8×8 (tinta, papel y brillo: 1 atributo en 8×8, 4 en 16×16), 8 banderas con
nombre (los 8 bits de `props`), un byte `val` libre para el código y un nombre opcional.
Es compatible con los tiles de zxgen (cadenas "X"/"." y atributos TL, TR, BL, BR).

Documento: `{"v":1,"size":16,"flags":[8 nombres],"tiles":[{"name","pix":[filas],"atr":[…],"props","val"}]}`,
un tile por línea.

Salidas para el código (nombre de la pestaña, p. ej. `set.tiles`):

| Fuente | Contenido |
|---|---|
| `INCBIN "set.tiles"` | Gráficos: por tile, size filas de size/8 bytes (alto primero). 8×8 = 8 bytes; 16×16 = 32. |
| `INCBIN "set.tiles#attr"` | Atributos: 1 byte por tile (8×8) o 4 (16×16: TL, TR, BL, BR). |
| `INCBIN "set.tiles#props"` | 1 byte por tile con las banderas. |
| `INCBIN "set.tiles#val"` | 1 byte por tile. |
| `INCLUDE "set.tiles#inc"` | Constantes: `set_COUNT`, `set_SIZE`, `set_GFX_BYTES`, `set_ATTRS`, una por bandera (`set_SOLID` = 1, `set_BLOCKS_SHOTS` = 2…) y `set_T_<NOMBRE>` = índice de cada tile con nombre. |

El nombre de la pestaña no puede llevar `#`, que separa la parte. En el código C, un
`.asm` auxiliar con el `INCLUDE`/`INCBIN` y `extern` (como los .asm de la librería).

Editor: lienzo de píxeles (clic izquierdo tinta, derecho papel, arrastrando), color y brillo del
cuadro (o de los cuatro), banderas, valor y nombre, reflejos, giro, inversión y desplazamiento
con vuelta, duplicar/borrar/reordenar tiles (los índices cambian), deshacer (Ctrl+Z / Ctrl+Y) e
**importar una hoja** de imagen: se corta en tiles del tamaño del conjunto, sin cambiar de
escala, y se convierten con los mismos criterios que las pantallas.

## `.map` — mapa de tiles

Documento JSON `{"v":1,"w","h","tiles","data","marks"}`: `w`×`h` celdas (1–255 por lado), cada una el
índice (0–255) de un tile del conjunto `.tiles` cuya pestaña nombra `tiles` (`""` = sin ligar), y
hasta 255 **marcadores** `{k,c,r}` (tipo, columna, fila; uno por celda) para lo que el código coloca
encima: enemigos, objetos, punto de inicio… El significado de `k` lo decide el código del usuario.

| Fuente | Contenido |
|---|---|
| `INCBIN "lvl.map"` | Celdas fila a fila: `w`·`h` bytes. |
| `INCBIN "lvl.map#cols"` | Celdas columna a columna (de arriba abajo, de izquierda a derecha), útil para scroll horizontal. |
| `INCBIN "lvl.map#rle"` | Las celdas por filas comprimidas en pares (cuenta 1–255, valor). |
| `INCBIN "lvl.map#marks"` | 3 bytes por marcador: tipo, columna, fila. |
| `INCLUDE "lvl.map#inc"` | `lvl_W`, `lvl_H`, `lvl_CELLS`, `lvl_RLE_BYTES`, `lvl_MARKS`. |

Editor: pincel (arrastrando; clic derecho recoge el tile de la celda), rectángulo, relleno,
marcadores (clic izquierdo pone el tipo elegido, derecho lo quita), zoom ×1–×4, redimensionado
(ancla arriba-izquierda, lo nuevo se rellena con el tile elegido) y deshacer (Ctrl+Z / Ctrl+Y). Avisa si
el mapa usa índices que el conjunto ligado no tiene (celdas en rojo oscuro con su número).

## Añadir un tipo de recurso

1. `registerResource({ ext, label, template, check, toBin, parts?, inc? })` en `web/src/res/` (`parts`: salidas `INCBIN "nombre.ext#parte"`; `inc`: constantes para `INCLUDE "nombre.ext#inc"`).
2. Un editor en `web/src/ui/res/` registrado con `registerResourceEditor(ext, factory)`;
   sin editor, la pestaña se edita como texto.
3. Alta en `registerBuiltinResources()` (`web/src/ui/res/index.ts`).
