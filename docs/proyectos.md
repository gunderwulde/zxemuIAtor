# Proyectos

Un **proyecto** reúne código y recursos de un juego que no cabe en una sola pestaña: varias
fuentes `.asm`/`.c`, recursos (`.scr`, `.tiles`, `.map`) y un manifiesto [`.tape`](recursos.md)
que dice qué bloques forman la cinta y de qué pestaña sale cada uno.

- **Ejecutar** (Ctrl+Enter) en el `.tape`, o en cualquiera de sus fuentes si el `.tape` es el
  principal: ensambla cada fuente una vez, compone el TAP, reinicia la máquina, inserta la cinta
  y teclea `LOAD ""` (`web/src/ui/tape-run.ts`). La carga la hace la trampa de LD-BYTES.
- **Depurar** y **Exportar TAP** parten de la misma construcción (`buildProject`,
  `web/src/ui/tabs/project.ts`): lo que se exporta es la cinta entera, no un bloque suelto.
- `PHASE`/`DEPHASE` permiten escribir código que se carga en una dirección y se ejecuta en otra
  (cargadores que se copian a sí mismos, piezas que un stub reparte con LDIR).
- Los gráficos van como recursos y entran con `INCBIN "x.scr#top"`, `"x.tiles"`…; si se editan,
  la cinta cambia sin tocar el ensamblador.

## Abrir y guardar proyectos

- **Ejemplos → Proyectos**: abre un ejemplo incluido (`web/src/examples/<id>/`: `project.json`
  con título, principal y orden de pestañas, más los ficheros). Sustituye el espacio de trabajo
  tras pedir confirmación y deja la copia de lo anterior en `localStorage` (`zx.tabs.backup`).
- **Nueva pestaña → Exportar / Importar proyecto .zxproj**: un `.zxproj` es el JSON del espacio de
  trabajo (pestañas, activa y principal), el mismo que se guarda en `zx.tabs`.

## Ejemplo: Sootland

`web/src/examples/sootland/` reconstruye **Sootland** (Zafiro Software / Spanish Soft, 1988),
cinta estándar de dos caras, byte a byte: los 14 bloques de la cinta original salen idénticos del
ensamblado. Es un proyecto "reensamblable y navegable": etiquetas por rutina y dato, una fuente
por bloque y comentarios sólo de lo que se entiende.

| Fichero | Contenido |
|---|---|
| `sootland.tape` | BASIC `SHOOT`, `loader.bin`, motor (sin cabecera), 4 niveles × (cabecera + cuerpo) y bloque final |
| `loader.asm` | bloque A (AFC8h): música, menú y cargador; el stub reubicado va en `PHASE 0AFC8h` |
| `engine.asm` | bloque B (D778h): marco (`hud.scr`), fuente (`font.tiles`), sprites (`sprites.tiles`) y el código del juego (EA60h) |
| `levelN.asm` | cabecera (129 celdas `lvN.tiles`, actores y apariciones) y cuerpo (4 fondos `lNx.scr#top`) |
| `final.asm` | último bloque de la cara 2 (C350h, entrada CE72h) |

**Origen y permiso.** © 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso;
gráficos: Alberto Herraiz y Fernando Pérez; música: J. Torres. El código y los gráficos se
incluyen con permiso expreso de su programador principal, que es quien ha pedido este ejemplo.
Cada fuente lleva este aviso en su cabecera.

### Sootland en C

`web/src/examples/sootland-c/` es el mismo juego con el **motor reescrito en C** (`engine.c`). Reutiliza
tal cual el cargador, los niveles y el bloque final de `sootland/` (entradas `"sootland/…"` de su
`project.json`); sólo cambia el bloque del motor, cuya fuente son dos ficheros:
`src: ["pieces.asm", "engine.c"]`, con `fill: 0` para los huecos y `#pragma org 0xEA60`.

| Fichero | Contenido |
|---|---|
| `engine.c` | toda la lógica: menús y carga de niveles, escenas, enemigos, bonus, disparo, vidas, puntuación |
| `hw.c` / `hw.h` | lo que sigue en ensamblador: IN/OUT, registro R, llamadas a la ROM (`print_str`, `LD-BYTES`…), los bucles de espera, el sonido del AY y el blit de sprites |
| `pieces.asm` | las tres piezas de recursos (marco, fuente y sprites) que reparte el stub de carga |

Reglas que se cumplen y se comprueban en `tests/examples/sootland-c.test.ts`: la imagen cabe en el
hueco hasta FFFAh (y `FFFFh`, el control elegido en el menú, queda libre); la cinta sólo difiere
en el bloque del motor; la pantalla al empezar es idéntica a la del original; y a igual número de
vueltas del bucle el juego tarda los mismos fotogramas (539 el original, 540 la versión en C).
El blit de sprites es lo único que en C era demasiado lento (1,9 veces) y por eso está en `hw.c`.

Diferencias y rarezas del original que se conservan a propósito:

- Los 768 bytes que reproduce el sonido (11 `FFh` y el resto a 0) eran datos de la imagen; en C no caben y se generan al vuelo.
- La tabla de apariciones son **registros de 3 bytes** (escena, columna, fila) que se leen en `3·((FRAMES & 15) + 1)`, no entradas de 6.
- Tras perder la última vida el nivel **no** vuelve a 1; la cifra de más peso de la puntuación (`digits[5]`) no se pone a cero al empezar partida; el récord no se actualiza nunca; y el búfer de fondo del segundo enemigo es la máscara del primero.
- El disparo comprueba además que el enemigo esté en la escena que se ve (en el original lo daba por hecho un efecto de los flags, equivalente en los estados alcanzables).

### Cómo se obtuvo (`tools/re/`)

Scripts que se ejecutan como tests con `npx vitest run --config vitest.re.config.ts tools/re/<n>.re.ts`
(no forman parte de `npm test`). Necesitan la cinta original en `tests/fixtures-local/sootland/`
(`Sootland - Side 1.tzx` y `Side 2.tzx`, fuera del repositorio).

1. `01`–`04`: arrancar la cinta en el núcleo, trazar con `Tracer` (cobertura de código y de
   inicios de instrucción) durante la intro y una partida con teclas pseudoaleatorias.
2. `lift.ts`: desensamblador recursivo desde las semillas; lo no alcanzado se emite como datos
   (cadenas detectadas), y el resultado se verifica ensamblándolo de nuevo, byte a byte.
3. `sootland-names.ts`: nombres, comentarios y palabras que alimentan el lifter (conocimiento
   humano sobre qué hace cada rutina).
4. `10`/`11`: partir los bloques de la cinta; los fondos (4 × 0x1200 = pixeles + atributos) y
   las celdas de sprites/fuente se pasan a `.scr`/`.tiles`.
5. `12-gen.re.ts`: genera `web/src/examples/sootland/` y comprueba la cinta reconstruida contra
   la original.

El test `tests/examples/sootland.test.ts` fija los SHA-256 de los bloques originales (no los
datos) y comprueba que el juego reconstruido arranca y carga el nivel 1.
