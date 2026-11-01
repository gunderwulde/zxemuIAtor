# Librería de C para el Spectrum (L1)

Cabeceras para el compilador de K1 (`web/src/cc`) con la implementación en ensamblador,
según la ABI de [docs/c-abi.md](../../../docs/c-abi.md). Cada cabecera enlaza sus `.asm` con
`#pragma link`. Un `.asm` enlazado se copia entero (no hay eliminación de código muerto
dentro de él).

| Cabecera | Enlaza | Bytes |
|---|---|---|
| `spectrum.h` | `zxgfx.asm` (569), `zxtext.asm` (753), `zxinput.asm` (333), `zxsound.asm` (201), `zxint.asm` (122) | 1978 |
| `string.h` | `string.asm` | 169 |
| `stdlib.h` | `stdlib.asm` (`exit` está en el crt0) | 52 |
| `stdio.h` | incluye `spectrum.h` | — |

`index.ts` exporta `CLIB_FILES` (nombre plano → fuente), `clibResolve(name)` (vale como
`includeResolver` del compilador y como `include` del ensamblador), `C_EXAMPLES` y
`DEFAULT_C_EXAMPLE` (el arco iris).

## Convenciones

- Coordenadas: píxeles x 0..255, y 0..191 (y ≥ 192 no se dibuja); celdas col 0..31,
  row 0..23. Colores 0..7 (`BLACK` … `WHITE`).
- Todas las rutinas conservan IX e IY. `beep` usa el juego alternativo y repone H'L'.
  Lo interno se llama `__zx_*`.
- El texto usa una rejilla propia de 32×24 y la fuente de la ROM: no usa RST 10h ni
  canales. 144..164 = UDG. Una nueva línea en la fila 23 desplaza la pantalla. `cls`
  tarda unos 2 frames (6912 bytes con LDIR).
- Teclado y joysticks leen la matriz directamente (sin la INT de la ROM). Joysticks en
  formato Kempston (`JOY_RIGHT` 1, `LEFT` 2, `DOWN` 4, `UP` 8, `FIRE` 16). Sin interfaz
  Kempston, el puerto 1Fh devuelve el bus flotante. `joy_kempston` da 0 si alguno de los
  bits 5-7 está a 1, pero un byte de pantalla con esos bits a 0 se cuela.
- `beep(hz, ms)`: bucle propio. El semiperiodo es 68 + 26n T (el cálculo está en
  `zxsound.asm`) y el error, ≤ 13 T por semiperiodo. Desactiva las interrupciones
  mientras suena y después las deja como estaban.

## Memoria fija

- **IM 2**: `I = 39h` usa como tabla de vectores la zona libre de la ROM 3900h–3A00h,
  que está llena de FFh. El vector siempre vale FFFFh, sea cual sea el byte del bus. En
  FFFFh hay un `JR` cuyo desplazamiento es el byte 0000h de la ROM (F3h = −13), y salta a
  FFF4h, donde va `JP __zx_isr`. Sólo se ocupan 12 bytes de RAM, **FFF4h–FFFFh** (el
  final del UDG "T" y el UDG "U"). Se guardan al instalar y se reponen en
  `im2_remove`. La rutina encadena con la INT de la ROM (0038h), que necesita
  IY = 5C3Ah, así que FRAMES, el teclado de BASIC y `frames()` siguen funcionando. El
  crt0 ejecuta `IM 1` al volver a BASIC.
- El resto del estado son variables de la propia librería dentro del programa: cursor,
  atributo, estado de `line`/sprites/`printf`, semilla y bytes guardados de IM 2.

## Tests

En `tests/clib/` (núcleo real):

- `gfx`, `text`, `input`, `sound`, `misc`: cada función, llamada desde ensamblador con
  la convención de C.
- `c-api`: la librería llamada desde C compilado.
- `examples`: los 10 ejemplos.
