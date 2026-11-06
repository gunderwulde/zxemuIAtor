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
