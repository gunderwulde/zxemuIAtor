# AGENTS.md — zxemuIAtor

Emulador web de **ZX Spectrum 48K** con precisión de T-state, más un IDE de ensamblador
Z80 a la izquierda del emulador. Este fichero define *cómo* se trabaja. *Qué* se hace y
en qué orden está en [PLAN.md](PLAN.md). La referencia de hardware es
[docs/zx48-hardware.md](docs/zx48-hardware.md).

## 1. Alcance fijado (no reabrir sin el usuario)

- Modelo: **48K Issue 3** (Issue 2 configurable para el bit 6 de 0xFE). Sin 128K/+2/+3.
- Fidelidad: contención por ciclo de bus en memoria e I/O, render de pantalla y borde al
  T-state (multicolor y borde funcionan), flags no documentados, MEMPTR, Q, bus flotante.
  **Snow fuera de alcance.**
- Formatos: TAP (carga rápida por trampa ROM), SNA, Z80 v1–v3 (48K). Sin TZX ni carga
  por pulsos.
- Núcleo: **C99 → wasm32 con clang**, sin libc, sin Emscripten.
- Frontend: **Vite + TypeScript**, CodeMirror 6, AudioWorklet.
- IDE: ensamblar e inyectar en RAM y saltar, depurador (registros, paso, breakpoints,
  desensamblado, memoria), resaltado de sintaxis, exportar TAP (con cargador BASIC) y SNA.
- ROM: `48.rom` original (permiso de Amstrad para emuladores), incluida en el repo.

## 2. Estructura del repositorio

```
core/                  Núcleo C → wasm
  include/zx.h         ABI pública (lo único que ve JS). CONTRATO CONGELADO.
  include/testbus.h    ABI de core-test.wasm. CONGELADO.
  src/bus.h            Contrato CPU↔máquina (static inline + unity build). CONGELADO.
  src/machine.h        Contrato entre módulos de la máquina (struct zx, video_*, audio_*, tape_*). CONGELADO.
  src/base.h           memcpy/memset sin libc, ZX_ASSERT
  src/z80.c            CPU Z80 (se incluye desde zx48.c y testbus.c, no se compila suelto)
  src/zx48.c           Máquina: mapa de memoria, contención, puertos, frame, INT
  src/video.c          Render perezoso de pantalla+borde a framebuffer RGBA 352×296
  src/audio.c          Registro de cambios del beeper y resampleado
  src/tape.c snap.c    Trampa LD-BYTES, TAP, SNA, Z80
  src/debug.c          Breakpoints, paso, ejecución hasta…
  src/testbus.c        Máquina plana de 64 KB sin contención (sólo build de tests)
rom/48.rom             ROM original (versionada; aviso de copyright en rom/README.md)
build/wasm/            Salida de build:core (no versionada); core.wasm se copia a web/public/wasm/
tools/                 Scripts Node: build-core, fetch-rom, fetch-tests, bench
web/                   App Vite
  src/emu/             Envoltorio wasm, bucle, vídeo, audio, teclado
  src/asm/             Ensamblador Z80 (TS puro, sin DOM)
  src/disasm/          Desensamblador (TS puro, comparte tabla con asm)
  src/export/          Generación TAP/SNA y cargador BASIC
  src/ui/              Editor, depurador, visor de memoria, layout
tests/                 Vitest: core/, asm/, disasm/, export/
tests/fixtures/        Descargados por tools/fetch-tests (en .gitignore)
docs/
```

## 3. Comandos

| Comando | Qué hace |
|---|---|
| `npm run build:core` | Compila `core.wasm` (máquina real), `core-test.wasm` (bus plano) y `core-probe.wasm` (máquina real con hooks de test) |
| `npm run fetch` | Descarga ROM y suites de tests a `rom/` y `tests/fixtures/` |
| `npm run dev` | Vite en desarrollo |
| `npm test` | Vitest completo (requiere build:core) |
| `npm run test:z80` | Sólo suites de CPU (FUSE, SingleStepTests, zexdoc/zexall, Rak) |
| `npm run bench` | Mide MHz emulados y ms/frame; imprime comparación con la línea base |

Flags de clang: `--target=wasm32 -nostdlib -O2 -std=c99 -Wall -Wextra -Werror
-Wl,--no-entry`. Las funciones públicas se marcan con `ZX_EXPORT`
(`__attribute__((export_name("…")))`, definida en `zx.h`); `--export-dynamic` no basta.
La memoria la exporta el módulo (`memory`). Nada de `malloc`: toda la memoria del núcleo
es estática.

Toolchain en esta máquina: Node 26 LTS y LLVM 23 (`C:\Program Files\LLVM\bin`, **no
está en el PATH**: `tools/build-core.mjs` usa `$LLVM_BIN` o esa ruta por defecto).

## 4. Metodología: Carmack / Abrash

Se aplica igual al **escribir** y al **revisar**. Un cambio que la incumple no se integra
aunque los tests pasen.

### 4.1 Principios de creación

1. **Entender el hardware antes de escribir código** (Abrash). Cada comportamiento del
   núcleo se apoya en una entrada de `docs/zx48-hardware.md` o en un test de la
   comunidad. Si no existe, se investiga y se documenta *primero*.
2. **La verdad la dice la medición, no la intuición.** Nada de optimizar sin un número de
   `npm run bench` antes y después, adjunto al cambio. Nada de afirmar exactitud sin un
   test que la demuestre.
3. **Código directo y en línea** (Carmack, "inlined code"). El bucle caliente es un
   `switch` plano sobre el opcode, con los ciclos de bus escritos explícitamente en el
   orden real. Nada de capas de abstracción, tablas de punteros a función en el camino
   caliente ni "frameworks" de instrucciones. Repetir tres líneas es preferible a una
   indirección que oculte el timing.
4. **El timing es parte del dato.** Cada acceso a bus lleva su contención en el sitio
   donde ocurre (`contend(addr, n)` justo antes del acceso). El patrón de bus de cada
   instrucción debe poder leerse en el código y compararse línea a línea con la tabla de
   la referencia.
5. **Estado explícito y visible.** Toda la máquina vive en structs estáticos planos
   (`Z80`, `Zx48`). Nada global oculto. Esto permite snapshots, rebobinado y tests
   deterministas gratis.
6. **Determinismo total.** Mismo estado inicial + mismas entradas por T-state = mismo
   resultado bit a bit. Nada de `Date`, aleatorio ni dependencias del frame rate dentro
   del núcleo. El frontend sólo entrega teclas con marca de T-state/frame.
7. **Lo más simple que sea correcto.** Sin generalizar para 128K "por si acaso". Si
   alguna vez se añade, se reescribe lo necesario.
8. **Hacer trabajo sólo cuando hace falta** (Abrash, render perezoso). Vídeo y audio se
   ponen al día bajo demanda (escritura en pantalla, OUT al borde, fin de frame), no en
   cada T-state.
9. **Asserts y comprobaciones baratas por todas partes en debug.** El build de tests
   activa `ZX_ASSERT`; el de producción las elimina.
10. **Leer el código generado cuando importa.** Para el bucle caliente se inspecciona el
    `.wat` (`wasm-objdump`/`wasm2wat`) al optimizar.

### 4.2 Principios de revisión

El revisor (otro agente, nunca el autor) recorre esta lista y responde a cada punto con
evidencia (línea, test o número), no con opinión:

- [ ] ¿Cada comportamiento nuevo tiene una fuente citada en docs o un test que lo fije?
- [ ] ¿Los patrones de ciclos de bus coinciden con la referencia? (comparar a mano al
      menos las instrucciones tocadas)
- [ ] ¿Hay alguna abstracción, indirección o generalización que no se pague sola?
- [ ] ¿Hay estado oculto, asignación dinámica o no determinismo en el núcleo?
- [ ] ¿Se ha medido el rendimiento si el cambio toca el camino caliente? ¿Empeora > 2 %?
- [ ] ¿Pasan todas las suites? ¿Se ha añadido un test que fallaba antes del cambio?
- [ ] ¿Se puede borrar algo? (el mejor código es el que no existe)
- [ ] ¿Cumple el ABI congelado de `zx.h`? Cambiarlo requiere aprobación del coordinador.

El resultado de la revisión es: **aprobado**, o una lista de hallazgos concretos con
`fichero:línea` y escenario de fallo.

### 4.3 Tests

El diseño completo está en [docs/TEST-PLAN.md](docs/TEST-PLAN.md). Regla de oro: el valor
esperado **nunca** sale del código bajo prueba (suite externa, dato documentado,
modelo de referencia independiente o la propia ROM).

### 4.4 Definición de terminado

Un trabajo está terminado cuando: compila sin warnings con `-Werror`, pasa `npm test`,
tiene tests propios, el bench no ha empeorado (si aplica), ha pasado la revisión de 4.2
y `docs/` refleja lo aprendido.

## 5. Contratos entre módulos

### 5.1 CPU ↔ máquina (`core/src/bus.h`)

La CPU no conoce el Spectrum. Llama a funciones `static inline` que cada build define:

```c
uint8_t bus_read(uint16_t a);            /* lectura de memoria, ya contendida */
void    bus_write(uint16_t a, uint8_t v);
void    bus_contend(uint16_t a, int t);  /* ciclo sin acceso que pone a en el bus, t T-states */
uint8_t bus_in(uint16_t port);           /* aplica la contención de E/S de §5 de docs */
void    bus_out(uint16_t port, uint8_t v);
```

El contador `tstates` vive en la máquina; la CPU lo avanza vía estas llamadas. `zx48.c`
y `testbus.c` son los dos únicos implementadores, elegidos al compilar (dos `.wasm`).

### 5.2 Núcleo ↔ JS (`core/include/zx.h`)

ABI congelada al final de la fase 0. Todas las funciones son `zx_*`, sólo enteros y
punteros a regiones estáticas:

- Ciclo de vida: `zx_init`, `zx_reset`, `zx_set_issue(int)`.
- Ejecución: `zx_run_frame()` → motivo de parada (frame completo / breakpoint),
  `zx_step()` (una instrucción), `zx_tstate()`.
- Regiones: `zx_framebuffer()` (RGBA 352×296), `zx_audio(int rate)` → nº de muestras
  float del último frame y `zx_audio_buffer()`, `zx_ram()` (64 KB plano), `zx_regs()`
  (struct de registros con layout documentado), `zx_io_buffer()` (zona de 128 KB para
  pasar ficheros).
- Entrada: `zx_key(row, bit, down)`.
- Ficheros: `zx_load_tap(len)`, `zx_load_sna(len)`, `zx_load_z80(len)`,
  `zx_save_sna()` → len (leen/escriben en `zx_io_buffer`).
- Depuración: `zx_bp_set(addr, on)`, `zx_bp_clear_all()`, `zx_poke(addr, v)`,
  `zx_set_pc(addr)`.

### 5.3 Ensamblador ↔ UI

`assemble(source: string, opts) → { bytes: Map<addr, Uint8Array> /*por segmento*/,
entry: number, symbols: Map<string, number>, lineMap: Array<{addr, line, len}>,
errors: Array<{line, col, msg}> }`. Puro, sin DOM, determinista.

## 6. Reglas de trabajo para agentes

- **Un agente, un directorio.** Cada tarea de PLAN.md declara los ficheros que posee.
  No se editan ficheros de otro flujo; si hace falta, se pide al coordinador.
- `zx.h`, `testbus.h`, `bus.h` y `machine.h` sólo los cambia el coordinador.
- En Windows, editar ficheros con las herramientas de edición, nunca con
  `Get-Content | Set-Content` de PowerShell 5 (rompe el UTF-8).
- Los tests van en el mismo cambio que el código. Primero el test que falla.
- Las suites externas no se modifican ni se "ajustan" para pasar.
- Si un dato de hardware es dudoso, se marca `[VERIFICAR]` en docs y se abre la duda,
  no se inventa.
- Comentarios: explicar el *porqué* del hardware ("la ULA repite la dirección en este
  ciclo"), no el *qué* del código.
- Idioma: código y nombres en inglés; docs y comentarios de hardware en español.
- Nada de dependencias npm nuevas sin justificarlo en el cambio (permitidas de base:
  vite, typescript, vitest, codemirror 6).
- Commits pequeños, uno por tarea, con mensaje que cite la tarea de PLAN.md (`[C2] …`).
