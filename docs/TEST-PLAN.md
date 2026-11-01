# Plan de tests — CPU Z80 y ULA 48K

Qué hay que probar para afirmar que la CPU y la ULA son correctas, cómo y contra qué.
Complementa [PLAN.md](../PLAN.md) (quién lo hace) y [zx48-hardware.md](zx48-hardware.md)
(los datos).

## 0. Principios

1. **El oráculo nunca es el código bajo prueba.** Cada valor esperado sale de una de
   estas fuentes, y el test dice cuál:
   - `EXT`: suite externa (FUSE, SingleStepTests, zex*, Rak).
   - `DOC`: dato de `zx48-hardware.md` con su fuente primaria.
   - `REF`: **modelo de referencia independiente** en TypeScript (`tests/ref/`), escrito
     por un agente distinto del autor del núcleo, lento y obvio a propósito
     (un T-state por iteración, sin cachés ni tablas).
   - `ROM`: deducible de la ROM original (p. ej. el texto de arranque dibujado con su
     propia fuente de caracteres en 0x3D00).
2. **Probar los tests** (mutación). Cada categoría debe fallar con al menos un fallo
   inyectado a propósito (§7). Un test que nunca ha fallado no demuestra nada.
3. **Primera discrepancia, con contexto.** Cada runner informa del primer punto de
   divergencia: instrucción, T-state, registros antes/después, eventos de bus esperados
   frente a obtenidos.
4. **Determinismo.** Ningún test depende del reloj real ni de la velocidad de la máquina.
5. **Tres velocidades**: `fast` (< 10 s, en cada cambio), `full` (< 3 min, antes de
   integrar), `soak` (sin límite, nocturno o manual).

## 1. Builds e instrumentación necesarios

| Build | Contenido | Uso |
|---|---|---|
| `core-test.wasm` | CPU + `testbus.c` (64 KB planos, sin contención) | CPU-* |
| `core-probe.wasm` | Máquina 48K real + `-DZX_TEST_HOOKS` | ULA-*, SYS-* |
| `core.wasm` | Producción, sin hooks | SYS-* de humo y bench |

Exports de test (sólo con `ZX_TEST_HOOKS`; sección aparte en `zx.h`, la añade el
coordinador):

- `zx_t_set_tstate(t)` / `zx_t_get_tstate()`: colocar la CPU en un T-state exacto del frame.
- `zx_t_contention(t)`: valor de la tabla de contención para un T-state.
- `zx_t_buslog_enable(on)`, `zx_t_buslog()`, `zx_t_buslog_len()`: registro de eventos
  `{t, kind: MR|MW|MC|PR|PW|INTA, addr, val}`, el mismo formato que FUSE.
- `zx_t_run_until(t)`: ejecutar instrucciones hasta alcanzar o superar el T-state t.
- `zx_t_beeper_log()`: transiciones `(t, nivel)` del frame actual.
- `zx_t_set_int_enabled(on)`: desactivar la INT de la ULA para tests aislados de CPU en la máquina real.

En `testbus.c` también hay registro de eventos (es lo que compara FUSE).

### Utilidades de test (`tests/util/`)

- `screenText(fb | ram)`: OCR exacto de la pantalla usando la fuente de la ROM
  (0x3D00–0x3FFF) → 24 líneas de 32 caracteres. Permite aserciones como
  `expect(screenText()).toContain("© 1982 Sinclair Research Ltd")`.
- `typeKeys("PRINT 2+2\n")`: pulsa y suelta teclas en frames concretos (sabe de los
  modos K/L/E de la ROM y de CAPS/SYM).
- `asm(src)`: usa el ensamblador A1 para escribir programas de prueba. **Excepción**:
  los tests CPU-* nunca usan A1 (bytes escritos a mano), para que un fallo del
  ensamblador no oculte uno de la CPU.
- `fbHash(fb)`: hash estable del framebuffer para tests de regresión.

---

## 2. CPU — tests unitarios por instrucción (`core-test.wasm`)

### CPU-01 FUSE `tests.in` / `tests.expected` · `EXT` · fast
- Unos 1 300 casos: estado inicial (registros, memoria), instrucciones a ejecutar
  hasta un T-state.
- Comparar **todo**: registros (AF, BC, DE, HL, alternos, IX, IY, SP, PC, I, R, IFF1/2,
  IM, HALT), MEMPTR si el fichero lo trae, T-states finales, memoria modificada y la
  **secuencia completa de eventos de bus** con su T-state (MR/MW/MC/PR/PW).
- Aceptación: 100 %. Sin lista de exclusiones.

### CPU-02 SingleStepTests/z80 · `EXT` · full
- 1 000 casos aleatorios por opcode, incluidos los prefijos CB, ED, DD, FD, DDCB y FDCB.
- Comparar estado final (incluidos `wz` = MEMPTR, `q`, `ei`, `p`), memoria, puertos y la
  lista de ciclos (dirección + tipo de acceso por ciclo) y el total de ciclos.
- `fast` ejecuta 25 casos por opcode; `full` los 1 000.
- Aceptación: 100 %.

### CPU-03 Flags no documentados por familia · `EXT`+`DOC` · fast
Casos escritos a mano y dirigidos (además de CPU-01/02, para que el fallo diga *qué*
regla se ha roto):

| Grupo | Qué se comprueba |
|---|---|
| XF/YF en ALU | bits 3/5 = resultado (ADD/SUB/AND/…); en CP = operando |
| BIT n,r / BIT n,(HL) / BIT n,(IX+d) | XF/YF del registro, de MEMPTR alto y de (IX+d) alto respectivamente |
| SCF/CCF con Q | `(Q ^ F) \| A` tras instrucción que tocó flags y tras una que no |
| LDI/LDD/LDIR/LDDR | XF = bit 3 de (A + n), YF = bit 1 de (A + n) |
| CPI/CPD/CPIR/CPDR | igual pero con (A − n − HF) |
| INI/IND/OUTI/OUTD y repetidos | reglas de Rak/Banks para HF, PF, CF, XF/YF, incluida la iteración que repite |
| DAA | las 2 048 combinaciones de A×(N,H,C) contra tabla de `DOC` |
| `LD A,I` / `LD A,R` | P/V = IFF2 |
| `IN r,(C)` / `IN F,(C)` | flags SZP, sin modificar CF |

### CPU-04 MEMPTR · `DOC` · fast
Cada instrucción que modifica MEMPTR (LD A,(nn), LD (nn),A, LD rr,(nn), JP/CALL,
RET/RETI/RETN, JR, DJNZ, RST, EX (SP),HL, ADD/ADC/SBC HL,rr, (IX+d), IN/OUT,
RLD/RRD, block ops, interrupciones) seguida de `BIT 0,(HL)` → comprobar XF/YF
esperados. Una fila por regla del documento de boo_boo & Kladov.

### CPU-05 Registro R · `DOC` · fast
- +1 por M1: instrucción simple, CB (2), ED (2), DD (2), DDCB (2: el opcode tras el
  desplazamiento no es M1), cadenas DD DD DD.
- Bit 7 preservado al desbordar; `LD R,A` fija el bit 7.
- Aceptación de interrupción incrementa R; HALT incrementa en cada ciclo repetido.

### CPU-06 Prefijos e instrucciones no documentadas · `DOC` · fast
- DD/FD sobre instrucciones sin HL → el prefijo cuesta 4 T y no hace nada.
- Cadenas DD FD DD … : sólo vale el último.
- IXH/IXL/IYH/IYL en todas las combinaciones legales; `LD H,(IX+d)` usa H real.
- DDCB/FDCB con registro: escribe en memoria **y** en el registro.
- ED inválidos: NOP de 8 T, R +2.
- SLL (CB 30–37), `OUT (C),0` (ED 71), NEG/RETN/IM duplicados (ED 4C, 54, 5C, …).

### CPU-07 Interrupciones · `DOC` · fast
| Caso | Esperado |
|---|---|
| IM0 con 0xFF en el bus | RST 38h, 13 T |
| IM1 | RST 38h, 13 T, IFF1=IFF2=0 |
| IM2 vector en `I*256+0xFF` | 19 T, PC = palabra leída, MEMPTR = PC |
| INT con IFF1=0 | ignorada |
| EI; INT pendiente | se acepta tras la instrucción **siguiente** a EI |
| EI; EI; EI… | nunca se acepta dentro de la cadena |
| INT entre prefijo DD y opcode | no se acepta |
| INT durante HALT | sale de HALT, PC apunta tras el HALT |
| NMI | 11 T, IFF1=0, IFF2 conserva, PC=0x66; RETN restaura IFF1 |
| INT justo tras `LD A,I` | P/V = 0 (bug NMOS) |
| Eventos de bus de INTA | patrón exacto (M1 extendido, dos escrituras de pila) |

### CPU-08 HALT · `EXT`+`DOC` · fast
- PC no avanza; cada ciclo M1 lee la dirección siguiente; R aumenta; 4 T por ciclo.
- Eventos de bus durante HALT (importa para la contención: ULA-05).

### CPU-09 Propiedades de bloque · `REF` · fast
- `LDIR` de N bytes ≡ N × `LDI` + reposicionar PC (mismo estado final salvo PC/T y
  flags de la iteración que repite); T total = 21·(N−1) + 16.
- Igual para CPDR/INIR/OTDR con sus tiempos.

### CPU-10 Fuzz diferencial contra el modelo REF · `REF` · soak
- Secuencias aleatorias de instrucciones en `core-test.wasm` y en el intérprete Z80 de
  referencia en TS (`tests/ref/z80ref.ts`, escrito a partir de la documentación, no del
  código C).
- Comparar estado y eventos de bus tras cada instrucción. Semilla registrada en cada
  fallo para reproducirlo.

---

## 3. CPU — tests de programa

### CPU-20 `prelim.com`, `zexdoc.com`, `zexall.com` · `EXT` · full
- Runner CP/M en `core-test.wasm`: programa en 0x0100, trampa en 0x0005 (funciones C=2
  y C=9), fin al llegar a 0x0000.
- Aceptación: ningún "ERROR" en la salida; los CRC impresos coinciden.

### CPU-21 z80test de Patrik Rak · `EXT` · full
- `z80full`, `z80doc`, `z80flags`, `z80docflags`, `z80ccf`, `z80memptr` en
  `core-probe.wasm` (máquina real, se cargan por trampa de cinta).
- Resultado leído con `screenText` / trampa en RST 10h.
- Aceptación: todos los tests pasan en las seis variantes.

### CPU-22 `cputest.com` (SuperSoft Diagnostics II) · `EXT` · full
Opcional, si se consigue con licencia redistribuible; mismo runner que CPU-20.

---

## 4. ULA — tests unitarios (`core-probe.wasm`)

Convención: T = T-state relativo al inicio de /INT del frame. `L(n) = 14335 + 224·n`
es el primer T contendido de la línea de pantalla n (0..191).

### ULA-01 Tabla de contención · `DOC`+`REF` · fast
- Recorrer los 69 888 T: `zx_t_contention(t)` == modelo REF
  (`[6,5,4,3,2,1,0,0][(t − L(n)) mod 8]` si `L(n) ≤ t < L(n)+128`, si no 0).
- Puntos fijos explícitos: 14334→0, 14335→6, 14336→5, 14340→1, 14341→0, 14342→0,
  14343→6, 14462→0 (último T de la ventana: offset 127 → patrón[7]), 14463→0, L(191)=57119→6,
  L(191)+128 → 0, 69887 → 0.

### ULA-02 Contención de memoria por instrucción · `EXT`+`REF` · full
El oráculo combina los eventos de FUSE (qué direcciones pone cada instrucción en el
bus, en qué ciclo) con el modelo REF de contención:

1. Para cada caso de FUSE `tests.in`: tomar la secuencia de eventos esperada.
2. Reubicar el código y los datos en zona contendida (0x4000–0x7FFF), en zona libre
   (0x8000+) y en mezcla (código libre, datos contendidos).
3. Para cada fase de inicio `L(10) + k`, k = −2 … 9: el modelo REF reproduce los
   eventos sumando contención en cada evento con dirección contendida → T total esperado.
4. Ejecutar en `core-probe.wasm` con la INT desactivada y comparar T total y el T de
   cada evento.

Cubre de golpe todas las instrucciones con su patrón de bus real, sin escribir a mano
1 300 tablas.

### ULA-03 Contención de E/S · `DOC` · fast
Los 4 casos de docs §5 × fases k = 0…7 dentro de una línea × `IN A,(n)`, `IN r,(C)`,
`OUT (n),A`, `OUT (C),r`, `INI/OUTI`. Puertos de prueba: 0x00FE, 0x40FE, 0x00FF,
0x40FF, 0x7FFE, 0x80FF. Esperado: T total y T del evento de E/S (REF).

### ULA-04 Fuera de la ventana · `DOC` · fast
Mismo código contendido ejecutado en el borde superior, el inferior, el borde
lateral (offset ≥ 128 de la línea) y 0x8000+: cero retardo.

### ULA-05 HALT y contención · `REF` · fast
HALT en 0x4000–0x7FFF durante la ventana de pantalla: cada M1 repetido sufre
contención. T de la aceptación de la INT siguiente == REF.

### ULA-10 Interrupción de la ULA · `DOC` · fast
| Caso | Esperado |
|---|---|
| Instrucción que empieza en T 31 con IFF1=1 | INT aceptada |
| Instrucción que empieza en T 32 | INT perdida en este frame `[VERIFICAR]` convención de Fuse |
| `DI` durante todo el frame, `EI` en T 20 + NOP | aceptada (sigue en ventana) |
| `EI` en T 30 + instrucción de 4 T | INT perdida |
| Instrucción larga (p. ej. `EX (SP),IX`, 23 T) que cruza el final del frame | el exceso pasa al frame siguiente y retrasa la aceptación |
| 50 frames | contador total = 50 × 69 888 + exceso final |
| Variable de sistema FRAMES (23672) con ROM | +1 por frame |

### ULA-11 Exceso de frame · `DOC` · fast
`zx_run_frame()` termina en el primer límite de instrucción ≥ 69 888; el siguiente
frame empieza en `t − 69888`. Verificado con instrucciones de 4, 11, 21 y 23 T en el
límite.

### ULA-20 Puerto 0xFE: teclado · `DOC` · fast
- Cada una de las 40 teclas aislada: sólo su bit a 0 en su semifila.
- Varias semifilas seleccionadas a la vez (`IN A,(0x00FE)`) → AND de todas.
- Ghosting: pulsar tres esquinas de un rectángulo de la matriz → la cuarta aparece.
- Bits 5 y 7 = 1. Cualquier puerto par responde (0x12FE, 0xFE00…).

### ULA-21 Puerto 0xFE: bit 6 (EAR) Issue 2/3 · `DOC` · fast
Tabla completa: últimos bits 3/4 escritos (00, 01, 10, 11) × Issue 2/3 → bit 6 leído.

### ULA-22 Puerto 0xFE: escritura · `DOC` · fast
Borde (bits 0–2) aparece en el framebuffer; bits 3/4 aparecen en el log del beeper con
el T exacto del ciclo de escritura de E/S; bits 5–7 ignorados.

### ULA-23 Bus flotante · `DOC`+`REF` · full
- Rellenar bitmap y atributos con valores que identifiquen la dirección (p. ej. bitmap =
  `addr & 0xFF` y atributo = `0x80 | fila`, sin colisiones dentro de una línea).
- Leer el puerto 0x40FF/0x00FF con `IN A,(n)` en cada T de una línea completa (barrido
  del inicio del ciclo de E/S de 0 a 223) en las líneas 0, 1, 7, 8, 100 y 191, y en
  líneas de borde.
- Esperado (REF parametrizado por el offset `[VERIFICAR]` de Fuse): bitmap, attr,
  bitmap+1, attr+1, 0xFF×4 por grupo de 8 T; 0xFF fuera de pantalla.
- Puertos pares nunca devuelven bus flotante.

### ULA-30 Geometría de la pantalla · `DOC` · fast
- Para cada uno de los 6 144 bytes de bitmap: poner un único byte a 0xFF con atributo
  fijo, renderizar, comprobar que se encienden exactamente los 8 píxeles esperados
  (fórmula de docs §3, desplazada 48 px horizontal y 48 líneas vertical en el
  framebuffer 352×296).
- Cada uno de los 768 atributos: tinta, papel y brillo en la celda 8×8 correcta.
- Paleta: los 16 colores RGBA exactos de docs §3.

### ULA-31 FLASH · `DOC` · fast
Celda con FLASH: frames 0–15 normal, 16–31 invertida, 32 normal. El contador de FLASH
no se reinicia con escrituras de atributo.

### ULA-32 Temporización del borde · `DOC`+`REF` · fast
- Barrido: `OUT (0xFE),A` cuyo ciclo de escritura de E/S termine en cada T de
  14 330 a 14 350 y en la línea 100 a todos los offsets 0…223.
- Esperado (REF): el cambio aparece en la columna `floor((t − t0)/4)·8` de la línea
  correspondiente con `t0` tal que T 14339–14342 → posición del byte 16384 (docs §7);
  granularidad de 8 px (cuatro T consecutivos producen la misma imagen).
- Cambios en borde superior, inferior, izquierdo y derecho; varios cambios por línea
  (rayas tipo carga de cinta).

### ULA-33 Multicolor y escritura durante el barrido · `REF` · fast
- Programa sincronizado con la INT que cambia el atributo de una celda en distintos
  T relativos al momento en que la ULA la lee: escritura **antes** de la lectura → color
  nuevo en esa línea; **después** → color viejo en esa línea y nuevo en la siguiente.
  Punto de corte exacto según REF.
- Igual para bytes de bitmap.
- Clásico 8×1: cambiar atributos en cada una de las 8 líneas de la fila de caracteres
  → 8 franjas de color distintas en una celda.

### ULA-34 Render perezoso ≡ render ingenuo · `REF` · full (fuzz soak)
- Generador aleatorio con semilla: secuencias de escrituras en 0x4000–0x5AFF y OUT al
  borde en T aleatorios de un frame (incluidos varios dentro del mismo grupo de 4 T y
  en el límite de línea).
- `video.c` (catch-up) frente al renderizador REF que evalúa cada píxel en su T-state
  con el estado de la memoria en ese instante.
- Aceptación: framebuffers idénticos en 10 000 frames (`full`: 500).

### ULA-40 Beeper · `DOC`+`REF` · fast
- Log de transiciones: T exacto del ciclo de E/S de cada OUT.
- Resampler: onda cuadrada de periodo P T-states → frecuencia fundamental
  3 500 000/P ±0,5 % (FFT), sin DC tras el filtro, sin clics en las fronteras de frame
  (continuidad de la integral entre frames).
- Niveles EAR/MIC: las 4 combinaciones dan los niveles de Fuse 1.6 de docs §12
  (0/0 = 0/1 = 0 < 1/1 = 50 < 1/0 = 52, normalizados por 52).

---

## 5. Sistema — ROM real (`core-probe.wasm` / `core.wasm`)

### SYS-01 Arranque · `ROM` · fast
Tras 150 frames desde reset: `screenText` contiene "© 1982 Sinclair Research Ltd" en
la línea 23; el resto de la pantalla en blanco; borde blanco; RAMTOP = 0xFF57 (variable
del sistema) y P-RAMT = 0xFFFF (comprobación de memoria de la ROM con 48 KB).

### SYS-02 Teclado → BASIC · `ROM` · fast
`typeKeys("PRINT 2+2\n")` → la pantalla muestra "4" y "0 OK, 0:1". Probar también
CAPS SHIFT, SYMBOL SHIFT, modo E, DELETE.

### SYS-03 Temporización vista desde BASIC · `ROM` · fast
- `PAUSE 50` dura 50 frames ±1.
- `BEEP 1,0` → beeper a 261,6 Hz ±1 % (do central) durante 1 s ±2 %.

### SYS-04 Cinta por trampa · `ROM` · fast
`LOAD ""` con un TAP sintético (cabecera BASIC + datos) → el programa aparece con
`LIST`; `LOAD "" CODE` de un bloque CODE → memoria idéntica; flag erróneo → "R Tape
loading error".

### SYS-05 Programas de prueba de la comunidad · `EXT` · manual/soak
Candidatos a localizar con licencia que permita usarlos en local
`[VERIFICAR]` disponibilidad: *ULA test* (Jan Bobrowski), *fusetest* (Fuse),
tests de bus flotante y de borde de la comunidad (WoS/Spectrum Computing). Se guardan
fuera del repo; el runner los usa si están presentes. Comprobación visual con capturas
de referencia descritas por su autor.

### SYS-06 Determinismo · `REF` · fast
- Dos ejecuciones del mismo guion de 1 000 frames (reset + teclas con marca de frame)
  → mismo `fbHash` en cada frame y mismo estado final.
- Snapshot interno en el frame 500, restaurar y continuar → idéntico a la ejecución sin
  interrumpir.

### SYS-07 Regresión de traza · `ROM` · fast
Hash de la traza `(PC, T)` de los primeros 5 millones de instrucciones desde reset,
guardado en el repo. **No es un oráculo de exactitud**: sólo detecta cambios no
intencionados; actualizarlo exige justificarlo en el cambio.

---

## 6. Matriz de cobertura

| Aspecto | Tests |
|---|---|
| Semántica de cada opcode | CPU-01, 02, 20, 21 |
| Flags documentados y no documentados | CPU-01, 02, 03, 21 |
| MEMPTR / Q | CPU-02, 04, 21 (`z80memptr`, `z80ccf`) |
| T-states y bus por instrucción | CPU-01, 02 |
| Interrupciones y HALT | CPU-07, 08, ULA-05, 10 |
| Contención de memoria | ULA-01, 02, 04, 05 |
| Contención de E/S | ULA-03 |
| Teclado y puerto FE | ULA-20, 21, 22, SYS-02 |
| Bus flotante | ULA-23 |
| Vídeo, borde y multicolor | ULA-30…34, SYS-01 |
| Audio | ULA-40, SYS-03 |
| Frame y exceso de T | ULA-10, 11, SYS-03 |
| Determinismo | SYS-06, 07 |

## 7. Mutaciones obligatorias (probar los tests)

`tools/mutate.mjs` aplica cada mutación al núcleo, recompila y ejecuta la suite
`fast`; **todas deben hacer fallar al menos un test**:

| Mutación | Debe detectarla |
|---|---|
| Quitar un `bus_contend` en `INC (HL)` | CPU-01, ULA-02 |
| Contención empieza en 14 336 | ULA-01, 02 |
| Patrón 6,5,4,3,2,1,0,0 rotado una posición | ULA-01 |
| XF/YF de CCF sin Q | CPU-03, 21 |
| MEMPTR no actualizado en `JP nn` | CPU-04 |
| R no incrementa en prefijo DD | CPU-05 |
| EI acepta INT inmediatamente | CPU-07 |
| Ventana INT de 31 T | ULA-10 |
| Borde sin cuantizar a 4 T | ULA-32 |
| Render que lee atributos al principio de la línea | ULA-33, 34 |
| Bus flotante desplazado 1 T | ULA-23 |
| Issue 2/3 invertidos | ULA-21 |

## 8. Orden de implementación

1. Utilidades y runners (T1): CPU-01 primero, porque es el más pequeño y lo cubre casi todo.
2. Modelos REF (`tests/ref/`): contención, renderizador ingenuo, Z80 de referencia
   (este último puede llegar en la fase 2).
3. ULA-01/30/20 en cuanto M1 tenga mapa de memoria y tabla.
4. CPU-02/20/21 cuando C1 pase CPU-01.
5. ULA-02/32/33/34 y SYS-* tras la integración de la fase 1.
6. Mutaciones (§7) como último paso de la aceptación de C1 y M1.
