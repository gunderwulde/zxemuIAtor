# PLAN.md — zxemuIAtor

Cómo se reparte el trabajo entre agentes y qué puede hacerse en paralelo. Las reglas de
trabajo y la metodología están en [AGENTS.md](AGENTS.md); los datos de hardware, en
[docs/zx48-hardware.md](docs/zx48-hardware.md).

Cada tarea indica: **posee** (ficheros que sólo ella edita), **depende de**, y
**aceptación** (condición objetiva de terminado). Toda tarea termina con una revisión
Carmack/Abrash (AGENTS.md §4.2) hecha por un agente distinto del autor.

```
Fase 0 (secuencial, coordinador)
   │  toolchain · esqueleto · zx.h/bus.h congelados · stubs que compilan
   ▼
Fase 1 (paralela, 7 agentes) ────────────────────────────────────────────
   C1 CPU Z80      T1 Arnés tests     M1 Máquina+vídeo   M2 Audio
   M3 Cinta/snap   W1 Shell web       A1 Ensamblador
   ▼  (integración por el coordinador: core.wasm real en la web)
Fase 2 (paralela, 5 agentes) ────────────────────────────────────────────
   I1 IDE editor   D1 Depurador+desasm   E1 Exportar TAP/SNA
   C2 Exactitud (Rak, timing ULA)        P1 Rendimiento
   ▼
Fase 3 (secuencial) revisión global · pulido · README
```

---

## Fase 0 — Cimientos (coordinador, secuencial) — ✅ COMPLETADA

Nada de esto se paraleliza: fija los contratos de los que depende todo lo demás.

Estado al cerrar: los tres `.wasm` compilan con `-Werror`; `npm test` pasa 11 tests de ABI;
`npm run build` genera la web; el servidor de desarrollo sirve COOP/COEP. Contratos
congelados: `zx.h`, `testbus.h`, `bus.h`, `machine.h`. Los módulos `z80.c`, `zx48.c`,
`video.c`, `audio.c`, `tape.c`, `snap.c` son **stubs** marcados con su flujo dueño.

| # | Tarea | Aceptación |
|---|---|---|
| 0.1 | Instalar toolchain: Node LTS y LLVM (clang + wasm-ld) vía winget; `git init` | `node -v`, `clang --version` y `wasm-ld --version` responden |
| 0.2 | `package.json`, Vite + TS + Vitest, `.gitignore`, `tsconfig` | `npm run dev` sirve una página vacía; `npm test` corre (0 tests) |
| 0.3 | `tools/build-core.mjs`: compila `core.wasm`, `core-test.wasm` y `core-probe.wasm` (máquina real + `ZX_TEST_HOOKS`, ver [docs/TEST-PLAN.md](docs/TEST-PLAN.md) §1) con los flags de AGENTS.md §3 | Los tres `.wasm` generados sin warnings |
| 0.4 | `tools/fetch-rom.mjs` y `tools/fetch-tests.mjs`: ROM desde la distribución de Fuse; FUSE tests, SingleStepTests/z80, zexdoc/zexall, z80test de Rak | Ficheros en `rom/` y `tests/fixtures/` con SHA verificado |
| 0.5 | Escribir `core/include/zx.h` y `core/src/bus.h` definitivos; stubs de todos los `zx_*` | Compila; un test Vitest instancia ambos wasm y llama a cada export |
| 0.6 | Layout del struct de registros (`zx_regs`) documentado en `zx.h` y su espejo TS en `web/src/emu/regs.ts` | Test que comprueba offsets |

**Fin de fase 0:** `zx.h`/`bus.h` congelados. A partir de aquí todos los flujos de la
fase 1 arrancan a la vez.

---

## Fase 1 — Construcción en paralelo

Los siete flujos sólo comparten los contratos de la fase 0, así que no se bloquean
entre sí. Cada uno trabaja contra stubs o mocks hasta la integración.

### C1 — CPU Z80
- **Posee:** `core/src/z80.c` (unity build: lo incluyen zx48.c y testbus.c; ver bus.h)
- **Depende de:** 0.5
- **Trabajo:**
  1. Struct `Z80` plano (registros, alternos, IX/IY, I, R, IFF1/2, IM, MEMPTR, Q, halted,
     ei_pending).
  2. `z80_step()`: `switch` por opcode para las tablas base, CB, ED, DD/FD, DDCB/FDCB.
     Cada instrucción escribe sus ciclos de bus en orden real con `bus_read/bus_write/
     bus_contend` (AGENTS.md §4.1.3–4).
  3. Tablas precalculadas de flags (SZ, SZP, XF/YF) en arrays estáticos `const`.
  4. Interrupciones (IM0/1/2, NMI, retardo de EI, bug de P/V en LD A,I/R), HALT, R.
  5. Todo lo no documentado de docs §9.
- **Aceptación:** 100 % FUSE `tests.in` (registros, memoria, T-states y eventos de bus);
  100 % SingleStepTests/z80 (estado y ciclos); zexdoc y zexall sin errores en
  `core-test.wasm`.

### T1 — Arnés de tests del núcleo
- **Diseño de los tests:** [docs/TEST-PLAN.md](docs/TEST-PLAN.md) (IDs CPU-*, ULA-*, SYS-*).
  Los modelos de referencia `tests/ref/` los escribe un agente distinto de C1/M1.
- **Posee:** `core/src/testbus.c`, `tests/core/**`, `tests/ref/**`, `tests/util/**`,
  `tools/fetch-tests.mjs` (tras 0.4), `tools/mutate.mjs`
- **Depende de:** 0.5 (trabaja con el stub de CPU; los tests fallarán hasta que C1 avance, eso es lo esperado)
- **Trabajo:**
  1. `testbus.c`: 64 KB planos, contador de T-states, **registro de eventos de bus**
     (`MR/MW/MC/PR/PW` con tiempo, dirección y valor) para comparar con FUSE.
  2. Runner de FUSE `tests.in/tests.expected`, runner de SingleStepTests (JSON).
  3. Runner CP/M para zexdoc/zexall: trampa en BDOS (0x0005, funciones 2 y 9), sale en
     `JP 0`. Salida en consola del test.
  4. Runner de z80test de Rak en `core.wasm` (máquina real): carga el TAP por trampa,
     captura la salida de texto interceptando RST 10h y busca el resumen final.
  5. Informe legible: primera discrepancia con diff de registros/eventos.
- **Aceptación:** los runners funcionan sobre la CPU de C1 a medida que avanza; un
  test de humo artificial (NOP, LD, JP) pasa en cuanto C1 los implementa.

### M1 — Máquina 48K y vídeo
- **Posee:** `core/src/zx48.c`, `core/src/video.c`
- **Depende de:** 0.5
- **Trabajo:**
  1. Mapa de memoria (ROM protegida), tabla de contención precalculada por T-state del
     frame (`uint8_t contention[69888 + margen]`), contención de E/S (docs §5).
  2. Puerto 0xFE (lectura con matriz de teclado + EAR + Issue 2/3; escritura borde/EAR/MIC).
  3. Bus flotante (docs §8).
  4. Bucle de frame: INT de 32 T al inicio, `zx_run_frame()` ejecuta hasta ≥ 69 888 T y
     arrastra el exceso al siguiente frame.
  5. `video.c`: render perezoso a RGBA 352×296. `video_catch_up(t)` llamado antes de
     cada escritura en 0x4000–0x5AFF, de cada OUT al borde y al fin del frame. FLASH.
- **Aceptación:** tests unitarios de la tabla de contención contra docs §4 (valores en
  T 14335…14342, fin de línea, borde); test de multicolor (programa que cambia atributos
  por línea → framebuffer esperado calculado); la ROM arranca y muestra
  "© 1982 Sinclair Research Ltd" (hash de framebuffer de referencia) cuando C1 esté listo.

### M2 — Audio (beeper)
- **Posee:** `core/src/audio.c`, `web/src/emu/audio.ts`, `web/src/emu/audio-worklet.ts`
- **Depende de:** 0.5
- **Trabajo:**
  1. En el núcleo: registro `(t, nivel)` por cambio de EAR/MIC; al fin de frame, integración
     por periodo de muestra a la frecuencia pedida, bloqueo de DC y paso bajo.
  2. En la web: AudioWorklet con ring buffer (SharedArrayBuffer si hay aislamiento de
     origen; si no, `postMessage`). Expone el nivel de llenado para que W1 regule el ritmo.
- **Aceptación:** test de una onda cuadrada sintética (OUT alternos a periodo fijo) →
  frecuencia fundamental correcta ±0,5 % y sin DC; sin cortes audibles en 60 s con el
  reloj de audio como maestro.

### M3 — Cinta y snapshots
- **Posee:** `core/src/tape.c`, `core/src/snap.c`, `tests/core/snap*.test.ts`
- **Depende de:** 0.5
- **Trabajo:** parser TAP; trampa LD-BYTES (docs §10) incluyendo verificar, flag
  incorrecto y fin de cinta; carga SNA y Z80 v1/v2/v3 (48K, descompresión); guardado SNA.
- **Aceptación:** round-trip SNA bit a bit; Z80 comprimido de prueba generado en el test
  y descomprimido idéntico; carga por trampa de un TAP de cabecera+datos sintético deja
  la memoria y los registros como la ROM.

### W1 — Shell web
- **Posee:** `web/index.html`, `web/src/main.ts`, `web/src/emu/core.ts`,
  `web/src/emu/display.ts`, `web/src/emu/input.ts`, `web/src/emu/loop.ts`,
  `web/src/ui/layout.*`
- **Depende de:** 0.5 (usa los stubs; un mock que pinta ruido sirve hasta la integración)
- **Trabajo:**
  1. Layout: panel IDE a la **izquierda** (redimensionable), emulador a la derecha con la
     barra de controles (reset, pausa, cargar fichero, Issue 2/3, escala).
  2. `core.ts`: carga del wasm, vistas tipadas sobre las regiones de `zx.h`.
  3. `display.ts`: `ImageData` sobre el framebuffer del wasm (sin copias), escalado
     entero con `image-rendering: pixelated`.
  4. `input.ts`: mapeo de teclado PC → matriz (incluye combinaciones: Backspace =
     CAPS+0, cursores = CAPS+5..8, signos de puntuación vía SYM SHIFT); el foco del
     teclado va al emulador sólo cuando el canvas tiene el foco (el editor no debe
     enviar teclas al Spectrum).
  5. `loop.ts`: reloj maestro de audio (consulta a M2); sin audio, acumulador con
     `requestAnimationFrame` a 50,08 Hz.
  6. Arrastrar y soltar TAP/SNA/Z80.
- **Aceptación:** con el mock, la UI funciona en Chrome y Firefox; layout correcto a
  1280 px y 1920 px; tests de la tabla de mapeo de teclas.

### A1 — Ensamblador Z80
- **Posee:** `web/src/z80isa/**` (tabla de instrucciones compartida), `web/src/asm/**`,
  `tests/asm/**`
- **Depende de:** nada (puede empezar incluso en la fase 0)
- **Trabajo:**
  1. `z80isa`: tabla única de todas las instrucciones (documentadas y no documentadas:
     IXH/IXL/IYH/IYL, SLL, DDCB con registro, `OUT (C),0`, `IN F,(C)`) → codificación. La
     usará también el desensamblador (D1).
  2. Lexer y parser de dos pasadas: etiquetas globales y locales (`.loc`), `$`,
     expresiones con precedencia (`+ - * / % & | ^ << >> ~`, `HIGH/LOW`), números
     `#FF`, `$FF`, `0FFh`, `%1010`, `'A'`.
  3. Directivas: `ORG`, `EQU`, `DEFB/DB`, `DEFW/DW`, `DEFS/DS`, `DEFM`, `ALIGN`,
     `MACRO/ENDM` con parámetros, `IF/ELSE/ENDIF`, `END [entrada]`.
  4. Salida según AGENTS.md §5.3: segmentos, entrada, símbolos, `lineMap`, errores con
     línea y columna. Rango de salto relativo comprobado.
- **Aceptación:** test exhaustivo: cada entrada de la tabla ensambla a los bytes
  esperados (tabla de referencia independiente escrita a mano a partir del manual de
  Zilog y de Sean Young); tests de directivas, macros, errores; ensamblar 5 000 líneas
  en menos de 50 ms.

### Integración de la fase 1 (coordinador)
Cuando C1 + M1 pasan su aceptación: `core.wasm` real en W1, la ROM arranca en el
navegador con imagen y sonido. M3 y A1 se enganchan a la UI de forma mínima (cargar
fichero, botón "Ensamblar" que de momento sólo muestra errores).

---

## Fase 2 — IDE, exactitud y rendimiento (paralela)

### I1 — Editor e inyección
- **Posee:** `web/src/ui/editor/**`, `web/src/ui/run.ts`
- **Depende de:** A1, W1, integración de fase 1
- **Trabajo:** CodeMirror 6 con lenguaje Z80 (resaltado de mnemónicos, registros,
  directivas, números y etiquetas), errores del ensamblador como diagnósticos, guardado
  automático en localStorage, ejemplos precargados (hola mundo con RST 10h, borde, bucle
  multicolor). **Ensamblar y ejecutar**: espera a que la ROM esté en un punto seguro (el
  bucle de espera de tecla de la ROM), escribe los segmentos con `zx_poke`, hace
  `PUSH PC` y salta a la entrada: un `RET` del programa vuelve a BASIC. Atajo Ctrl+Enter.
- **Aceptación:** el ejemplo "hola mundo" se ve en pantalla tras Ctrl+Enter y al hacer
  RET se recupera el cursor de BASIC; los errores aparecen subrayados en la línea correcta.

### D1 — Desensamblador y depurador
- **Posee:** `web/src/disasm/**`, `web/src/ui/debugger/**`, `core/src/debug.c`
- **Depende de:** A1 (`z80isa`), integración de fase 1
- **Trabajo:** desensamblador sobre `z80isa`; panel de registros y flags (resalta lo
  que cambia), pausa/continuar/paso/paso por encima/hasta el cursor; breakpoints desde
  el margen del editor (por `lineMap`) y desde el desensamblado; línea actual resaltada
  en el código fuente; visor de memoria hexadecimal editable; indicador de T-state,
  línea de pantalla y frame. En el núcleo: mapa de bits de 64 K de breakpoints
  consultado en `zx_run_frame` con coste mínimo cuando no hay ninguno.
- **Aceptación:** round-trip `ensamblar(desensamblar(bytes)) == bytes` para los 64 K
  opcodes posibles más sus prefijos; con breakpoints desactivados el bench no empeora
  más de un 1 %.

### E1 — Exportar TAP / SNA
- **Posee:** `web/src/export/**`, `tests/export/**`
- **Depende de:** A1; M3 para guardar SNA
- **Trabajo:** cargador BASIC tokenizado (`10 CLEAR inicio-1: LOAD ""CODE: RANDOMIZE USR
  entrada`) + cabecera CODE + datos → `.tap`; `.sna` a partir del estado actual
  (`zx_save_sna`). Descarga desde la UI.
- **Aceptación:** el TAP exportado, cargado en el propio emulador con `LOAD ""`, ejecuta
  el programa; checksums verificados en el test.

### C2 — Exactitud de la máquina
- **Posee:** `tests/accuracy/**`, `tests/fixtures-own/**` (programas de prueba propios en asm)
- **Depende de:** integración de fase 1. Corrige vía hallazgos dirigidos a C1/M1 (no edita sus ficheros).
- **Trabajo:** z80test completo de Rak (`z80full`, `z80doc`, `z80flags`, `z80ccf`,
  `z80memptr`) en la máquina real; programas de prueba propios para contención
  (medir T-states con bucles sincronizados a la INT), alineación del borde
  (OUT en T 14339–14342), bus flotante, multicolor; resolver todos los `[VERIFICAR]` de
  docs.
- **Aceptación:** z80test 100 %; cero `[VERIFICAR]` pendientes; cada test propio
  documenta la fuente del valor esperado.

### P1 — Rendimiento
- **Posee:** `tools/bench.mjs`, `bench/**`
- **Depende de:** integración de fase 1. Propone cambios a C1/M1 con números; no edita sus ficheros.
- **Trabajo:** bench reproducible (ROM + programa de carga fija, N frames, mediana);
  línea base; inspección del `.wat` del bucle caliente; propuestas medidas.
- **Aceptación:** ≥ 20× tiempo real (frame < 1 ms) en un portátil moderno, o el
  informe de por qué no y qué lo limita.

---

## Fase 3 — Cierre (secuencial)

1. Revisión global Carmack/Abrash por un agente que no haya escrito el núcleo,
   leyendo el código sin las conclusiones de los autores.
2. Pulido de UX: estado vacío, mensajes de error de carga, atajos documentados en la UI.
3. `README.md`: uso, compilación, licencia de la ROM (aviso de copyright de Amstrad).

---

## Matriz de paralelismo

| Flujo | Fase | Bloqueado por | Bloquea a |
|---|---|---|---|
| C1 CPU | 1 | 0.5 | integración, C2, P1 |
| T1 Arnés | 1 | 0.5 | aceptación de C1 |
| M1 Máquina/vídeo | 1 | 0.5 | integración, C2, P1 |
| M2 Audio | 1 | 0.5 | loop real de W1 |
| M3 Cinta/snap | 1 | 0.5 | E1 (SNA), runner de Rak de T1 |
| W1 Shell web | 1 | 0.5 | I1, D1 |
| A1 Ensamblador | 0–1 | — | I1, D1, E1 |
| I1 Editor | 2 | A1, W1, integración | — |
| D1 Depurador | 2 | A1, integración | — |
| E1 Exportar | 2 | A1, M3 | — |
| C2 Exactitud | 2 | integración | fase 3 |
| P1 Rendimiento | 2 | integración | fase 3 |

Máximo de agentes simultáneos: **7** en la fase 1 y **5** en la fase 2, más un revisor
por tarea al cerrar.

## Riesgos conocidos

- **Precisión del borde/bus flotante ±1 T** entre fuentes: se fija con los valores de
  Fuse y se documenta (C2).
- **Ritmo de audio vs. pantalla** (50,08 Hz frente a 60/144 Hz): reloj maestro de audio;
  el vídeo muestra el último frame completo.
- **SharedArrayBuffer** requiere cabeceras COOP/COEP; Vite las sirve en dev; si el
  hosting final no puede, se usa `postMessage` (M2).
- **Inyección de código** sin un punto seguro puede romper la ROM: por eso I1 espera al
  bucle de teclado.
