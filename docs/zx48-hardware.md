# ZX Spectrum 48K — referencia de hardware para el emulador

Documento de trabajo. Todo dato aquí es **una afirmación verificable**: si un test o
una fuente primaria lo contradice, gana la fuente y se corrige este fichero en el
mismo cambio. Las marcas `[VERIFICAR]` indican datos que hay que contrastar con el
código de Fuse antes de darlos por buenos.

Fuentes primarias (por orden de autoridad):

1. Comportamiento medido: tests de Patrik Rak (`z80test`), FUSE `tests.in/tests.expected`,
   SingleStepTests/z80 (JSON por instrucción con ciclos de bus), zexall/zexdoc.
2. *ZX Spectrum 48K Technical Reference* — https://worldofspectrum.org/faq/reference/48kreference.htm
3. *The Undocumented Z80 Documented* (Sean Young) — flags XF/YF, prefijos, IM, R.
4. *MEMPTR, esoteric register of the ZiLOG Z80* (boo_boo, V. Kladov).
5. Código de Fuse (`z80/`, `spectrum.c`, `ula.c`, `tape.c`, `snapshot`/libspectrum) como
   implementación de referencia para dudas de timing.
6. *The Complete Spectrum ROM Disassembly* (Logan & O'Hara) — rutinas de ROM (LD-BYTES, etc.).

---

## 1. Reloj y frame

| Parámetro | Valor |
|---|---|
| Reloj CPU | 3 500 000 Hz |
| T-states por línea | 224 (128 pantalla + 24 borde dcho + 48 retrazo + 24 borde izq) |
| Líneas por frame | 312 (64 superiores + 192 pantalla + 56 inferiores) |
| T-states por frame | 69 888 → 50,08 Hz |
| Pixel | 2 píxeles por T-state (8 px = 4 T) |

## 2. Interrupción

- La ULA baja /INT al inicio del frame (T=0) durante **32 T-states** (48K). Si la CPU no
  la acepta en esa ventana, se pierde. Convención exacta (Fuse 1.6 `z80/z80.c`
  `z80_interrupt`, `interrupt_length` = 32 de libspectrum para el 48K): se acepta en un
  límite de instrucción con T < 32 (31 sí, 32 no), si IFF1 = 1 y la instrucción anterior
  no es EI. Fijado por ULA-10.
- Bus de datos durante INTA: 0xFF (IM2 lee el vector en `(I*256 + 0xFF)`).
- Aceptación: IM0/IM1 → 13 T (IM1 = RST 38h); IM2 → 19 T. Incrementa R.
- EI: la interrupción no se acepta hasta **después** de la instrucción siguiente a EI.
- Cadenas de prefijos DD/FD: no se acepta INT entre prefijo e instrucción (Sean Young,
  *The Undocumented Z80 Documented*: un DD/FD seguido de otro prefijo actúa como un NOP
  de 4 T y la INT sólo se acepta tras la instrucción completa). Modelo del núcleo: como
  en Fuse, cada prefijo sin efecto seguido de otro DD/FD termina el `z80_step` (64 KB
  de DD no son un único paso infinito); el prefijo pendiente queda en `ei_delay` =
  0xDD/0xFD, que además impide aceptar la INT, y el paso siguiente despacha ese
  prefijo sin repetir su M1. `zx_set_pc` y las cargas de snapshot lo descartan; la
  trampa de cinta no actúa con un prefijo pendiente. Fijado por CPU-07
  (`tests/core/cpu/targeted.test.ts`).
- `LD A,I` / `LD A,R`: P/V = IFF2. Bug NMOS: si se acepta una INT justo tras ellas, P/V queda a 0.
- HALT: repite ciclos M1 (4 T, R+1) hasta INT/NMI; cada ciclo es contendido si la
  dirección está en 0x4000–0x7FFF. **Qué dirección**: en hardware el PC ya ha avanzado
  y los M1 repetidos ponen HALT+1 en el bus (SingleStepTests `76`: final.pc = HALT+1).
  El núcleo sigue la convención de Fuse, exigida por `tests.expected` (caso `76`): el
  PC se queda en el propio HALT y los M1 leen esa dirección; al aceptar la INT/NMI el
  PC avanza antes de apilarse, así que la dirección apilada es la misma (HALT+1). La
  única diferencia observable es la contención con el HALT en 0x3FFF (el hardware
  contendería sobre 0x4000 y aquí no) o en 0x7FFF (al revés). Se acepta.
- Breakpoints (convención del depurador, no hardware): un breakpoint en un HALT para al
  llegar a él, no en cada M1 mientras espera la INT (`zx48.c` `run_one`:
  `bp_skip = halted`). Sin breakpoints `zx_run_frame` usa un bucle que no los
  comprueba. Fijado por `tests/debugger/core-bp.test.ts`.

## 3. Memoria

| Rango | Contenido |
|---|---|
| 0x0000–0x3FFF | ROM 16 KB (escrituras ignoradas) |
| 0x4000–0x57FF | Bitmap de pantalla (6144 B) |
| 0x5800–0x5AFF | Atributos (768 B) |
| 0x4000–0x7FFF | RAM **contendida** (compartida con la ULA) |
| 0x8000–0xFFFF | RAM no contendida |

Dirección de un byte de bitmap para (x en bytes 0..31, y en líneas 0..191):

```
addr = 0x4000 | ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | x
       bits:  0 1 0 Y7 Y6 Y2 Y1 Y0 | Y5 Y4 Y3 X4 X3 X2 X1 X0
attr = 0x5800 + (y >> 3) * 32 + x
```

Atributo: bit7 FLASH, bit6 BRIGHT, bits5–3 PAPER, bits2–0 INK. FLASH intercambia tinta y
papel cada 16 frames (ciclo de 32).

Paleta (índice GRB: 0 negro, 1 azul, 2 rojo, 3 magenta, 4 verde, 5 cian, 6 amarillo,
7 blanco). Intensidad normal ≈ 0xD7, BRIGHT = 0xFF; negro brillante = negro.

## 4. Contención de memoria (48K)

- Primer T-state contendido: **14 335** (relativo al inicio de /INT).
- En cada una de las 192 líneas de pantalla hay 128 T contendidos a partir de
  `14335 + línea*224`. El retardo según `(t - inicio_línea) % 8` es:
  **6, 5, 4, 3, 2, 1, 0, 0**. Fuera de esa ventana, retardo 0.
- Afecta a todo acceso a 0x4000–0x7FFF y a ciertos puertos (ver §5).
- La contención se aplica **por ciclo de bus** (cada M-cycle que pone la dirección en el
  bus, incluidos los ciclos internos que repiten la dirección: p. ej. `INC (HL)` es
  `pc:4, hl:3, hl:1, hl:3`). El patrón de cada instrucción está tabulado en la
  referencia del 48K (§ "Contended memory") y en Fuse (`z80_ops.c`). El núcleo debe
  reproducirlo **literalmente**; los tests de timing (Rak, FUSE) lo verifican.
- Un mismo modelo puede variar ±1 T entre unidades. Fijamos los valores de Fuse.

## 5. Contención de E/S

Un puerto es de la ULA si el bit 0 de la dirección es 0.

| High byte en 0x40–0x7F | Bit 0 | Patrón |
|---|---|---|
| No | 0 | N:1, C:3 |
| No | 1 | N:4 |
| Sí | 0 | C:1, C:3 |
| Sí | 1 | C:1, C:1, C:1, C:1 |

`N:n` = n T sin retardo; `C:n` = aplicar contención en ese instante y luego n T.

## 6. Puerto 0xFE

Escritura: bits 0–2 borde, bit 3 MIC, bit 4 EAR (altavoz), bits 5–7 sin uso.

Lectura: bits 0–4 teclado (0 = pulsada), bit 6 EAR in, bits 5 y 7 = 1.
- **Issue 3** (por defecto): sin señal de cinta, bit 6 refleja el último bit 4 escrito.
- **Issue 2**: bit 6 a 0 sólo si bits 3 **y** 4 escritos son 0.
- Tras pasar bit 4 de 1 a 0 hay un retardo de ~180–2800 T hasta que la lectura se
  estabiliza (efecto analógico; implementar sólo si algún test lo exige).

Teclado: cada bit a 0 del byte alto selecciona una semifila; el resultado es el AND de
todas las semifilas seleccionadas.

| Puerto | bit0 | bit1 | bit2 | bit3 | bit4 |
|---|---|---|---|---|---|
| 0xFEFE | CAPS SHIFT | Z | X | C | V |
| 0xFDFE | A | S | D | F | G |
| 0xFBFE | Q | W | E | R | T |
| 0xF7FE | 1 | 2 | 3 | 4 | 5 |
| 0xEFFE | 0 | 9 | 8 | 7 | 6 |
| 0xDFFE | P | O | I | U | Y |
| 0xBFFE | ENTER | L | K | J | H |
| 0x7FFE | SPACE | SYM SHIFT | M | N | B |

Ghosting: tres teclas en esquina de rectángulo producen la cuarta (modelar la matriz,
no una tabla de teclas).

## 7. Vídeo y borde

- El byte de pantalla 16384 se dibuja 14 336 T después de /INT.
- Un `OUT (0xFE)` cuyo **dato de E/S** (instante en que la ULA ve el valor: inicio del
  ciclo de E/S + 1 T + contención "early", §5) cae en T ≤ 14 339 ya se ve en el grupo
  de 8 píxeles del byte 16384 (T<sub>g</sub> = 14 336 y regla t ≤ T<sub>g</sub> + 3,
  abajo); si cae en 14 340–14 343, desde el grupo siguiente. En un `OUT (n),A` sin
  contención el dato va 3 T antes del final de la instrucción. A partir de ahí: 4 T =
  8 píxeles, 224 T = 1 línea.
- El borde se muestrea en unidades de 8 píxeles (4 T) → no hay cambios de borde
  más finos que eso en 48K. Alineación (resuelto con Fuse 1.6: `display.c`
  `display_write_if_dirty`/`display_dirty_*`, `display_border.c`, `peripherals/ula.c`
  `ula_write`): el grupo de 8 px (gx 0..43, fy 0..295 del framebuffer 352×296) tiene
  T<sub>g</sub> = 14 336 + (fy − 48)·224 + (gx − 6)·4 y muestra todo evento (escritura en
  pantalla o en el borde) con t ≤ T<sub>g</sub> + 3. El t de un `OUT` es el del dato de
  E/S = inicio del ciclo de E/S + 1 + retardo de contención "early" (§5); con
  `OUT (n),A` sin contención, fin − 3. El t de una
  escritura en memoria es el final de su ciclo de bus (Fuse avanza `tstates` en
  `contend_write` antes de `writebyte`). Fuse sólo define 240 líneas visibles; aquí la
  fórmula se extrapola linealmente a las 296. Fijado por `tests/ref/video.ts` y
  ULA-30…34 (`tests/core/ula/`).
- Área visible que emulamos: 48 px de borde izq/dcho, 48 líneas superiores, 56
  inferiores → framebuffer **352 × 296**.
- La ULA lee bitmap y atributo *en el momento* en que se dibujan: los efectos multicolor
  (cambiar atributos mientras se dibuja) deben funcionar. Técnica: render perezoso
  ("catch-up") hasta el T-state actual antes de cada escritura en 0x4000–0x5AFF y antes
  de cada `OUT` al borde; al final del frame se completa el resto.

## 8. Bus flotante

Al leer un puerto que nadie decodifica (bit 0 = 1, sin periféricos) se devuelve lo que
la ULA tiene en el bus: durante la ventana de pantalla, en cada grupo de 8 T de una
línea, la ULA lee bitmap, atributo, bitmap+1, atributo+1 y luego 4 T de 0xFF; fuera de
pantalla siempre 0xFF. T exactos (resuelto con Fuse 1.6 `spectrum.c`
`spectrum_unattached_port`, muestreado en el T del dato de E/S de §5): el primer byte
(bitmap de 0x4000) se ve en T 14 338; en cada línea n (0..191) y grupo de 8 T que
empieza en 14 336 + 224n + 8x (x = 0..15), los offsets 2, 3, 4 y 5 devuelven bitmap,
atributo, bitmap+1 y atributo+1 de la columna 2x, y los offsets 6, 7, 0 y 1 devuelven
0xFF. Fijado por `tests/ref/floatingbus.ts` y ULA-23.

Snow (I en 0x40–0x7F): fuera de alcance (decisión del usuario).

## 9. Z80: detalles no documentados obligatorios

- Flags XF (bit 3) e YF (bit 5): copiados del resultado o de fuentes específicas por
  instrucción (BIT n,(HL) usa MEMPTR alto; bloque LDI/CPI/INI/OUTI tienen reglas propias).
- **MEMPTR (WZ)**: registro interno, visible vía `BIT n,(HL)`. Reglas completas en la fuente 4.
- **Q**: SCF/CCF calculan XF/YF como `((Q ^ F) | A) & 0x28`, donde Q = F si la
  instrucción anterior modificó flags, si no 0 (variante Zilog NMOS). POP AF y
  EX AF,AF' cargan F sin la ALU y dejan Q = 0 (SingleStepTests `f1` y `08`: final.q = 0
  en los 1000 casos de cada uno, la mitad con q inicial ≠ 0). Un prefijo DD/FD también
  deja Q = 0 (SingleStepTests `DD 37`/`FD 3F`). Tras aceptar una INT o NMI el núcleo
  pone Q = 0 `[VERIFICAR]`: ninguna fuente lo fija (SingleStepTests no prueba
  interrupciones; Fuse y Rak no lo ejercitan). Sólo afecta a un SCF/CCF que sea la
  primera instrucción de la ISR.
- R: los 7 bits bajos se incrementan en cada M1 (prefijos incluidos); bit 7 se conserva.
- `OUT (C),0` (ED 71) escribe 0 en NMOS. `IN F,(C)` (ED 70) sólo afecta flags.
- DDCB/FDCB: la versión no documentada escribe el resultado en un registro además de en memoria.
- Prefijos ED inválidos = NOP de 8 T. DD/FD sin efecto = prefijo de 4 T.
- INIR/OTIR/LDIR/CPIR repetidos: flags no documentados en la iteración que repite
  (investigación de 2018, David Banks / Rak) — exigido por los tests de Rak.

## 10. Cinta (TAP) y carga rápida

TAP: secuencia de bloques `[len16 LE][flag][datos…][xor]`, donde `len` incluye flag y
checksum. Flag 0x00 = cabecera (17 bytes: tipo, nombre[10], longitud, param1, param2),
0xFF = datos.

Carga rápida: trampa en la rutina ROM **LD-BYTES (0x0556)** y en **LD-BREAK
(0x056B)**, el `RET NZ` al que llegan también los cargadores que entran por 0x0562 con
su propio preámbulo (Fuse 1.6 atrapa sólo en 0x056B, `tape_traps.c`; en 0x056B con
Z = 0 la ROM está saliendo por BREAK y no se atrapa). Entrada: IX = destino,
DE = longitud, A = flag esperado, CF = 1 cargar / 0 verificar. Salida: CF = 1 si OK.

- Sólo actúa en un límite de bloque (cinta parada, en el tono guía o en la pausa del
  anterior), sin prefijo DD/FD pendiente y sin INT pendiente (IFF1 = 1, sin EI previo
  y T < 32): con INT la CPU la acepta antes, como el hardware, y la ISR vuelve a 0x0556
  con EI retrasando la siguiente (`trap.test.ts`, "INT pendiente al entrar").
- **Estado de salida: el de la ROM, no el de Fuse.** Se modela el bucle 0x05A3–0x05E2
  (`tape.c` `load_block`) y se ha contrastado registro a registro con la propia ROM
  leyendo los pulsos del reproductor (`trap.test.ts`, "ROM real"). Difiere de lo que
  documenta Fuse (`tape_trap_load_block`: C = 1, L = último dato, AF' = 0145, B intacto
  al fallar el flag). Resumen: en el final normal A/F = `LD A,H; CP 1` con H = paridad
  (CF = 1 éxito) y B = 0xB0; bloque más corto que DE → B = 0, AF = 0050, L = 1; RET NZ
  de LD-FLAG/LD-VERIFY → AF = el del bucle y AF' = D|E con flags de OR; DE e IX avanzan
  por byte. La salida es **siempre** por el RET de 0x05E2 (todas las salidas de
  LD-BYTES pasan por él), que vuelve a SA/LD-RET (0x053F) apilado por el preámbulo.
- C tras la sincronía: LD-EDGE complementa C en cada flanco y su bit 5 sigue a EAR;
  con el reproductor de `tape.c` el nivel al empezar los datos es 0 y C = 0xDE.
  `[VERIFICAR]` la polaridad inicial: no está en el TAP; con una cinta real podría ser
  la contraria (C = 0x21).

Reproducción por pulsos (respaldo para cargadores propios). Tiempos de la ROM (los que
Fuse reconoce como "ROM pilot", `pzx_has_rom_pilot`): guía de 2168 T × 8063 pulsos
(cabecera, flag < 0x80) o × 3223 (datos); sincronía 667 + 735 T; bit 0 = 2 × 855 T,
bit 1 = 2 × 1710 T; pausa de 1000 ms tras cada bloque (libspectrum, bloques TAP). Cada
límite de pulso es un flanco. La cinta se para sola al acabar la pausa de cada bloque.

Arranque automático (sin fuente de hardware: en la máquina real el usuario pulsa PLAY;
`tape.c`, constantes `AUTO_*`):

1. Si la ROM lee EAR dentro de 0x0562–0x0605 (LD-BYTES/LD-EDGE), arranca ya.
2. Fuera de la ROM, sospecha: 2 frames seguidos con ≥ 256 lecturas de un puerto par
   con DI, cada una a ≤ 200 T de la anterior (bucle cerrado de muestreo; LD-SAMPLE de
   la ROM muestrea cada 59 T). La cinta arranca a prueba.
3. Prueba: un cargador sale de su bucle al ver un flanco, así que la lectura que sigue
   a un cambio de nivel llega > 20 T más tarde que el ritmo del bucle. De los primeros
   16 cambios, al menos la mitad deben ir así; si no, o si la guía se acaba antes, la
   cinta se para y se rebobina al inicio del bloque (nivel a 0).
4. Si la trampa se dispara con un bloque arrancado así y a medias, lo rebobina y lo
   carga entero (el programa ha abandonado la lectura por pulsos).

Límites conocidos: un programa con DI que lee 0xFE en bucle y cuyo ritmo cambia justo
tras los cambios de EAR (o que alterna lecturas con periodos que difieren en más de
20 T) pasa la prueba y la cinta avanza; si eso dura un bloque entero (guía + datos +
pausa, ≥ 3 s) ese bloque se pierde. Un cargador que, tras un flanco, sigue muestreando
al mismo ritmo (sin salir del bucle) no pasa la prueba y no carga por pulsos. Fijado
por `trap.test.ts` (menú en bucle de 41 T con la cinta montada, cargador LD-BYTES
reubicado en 0xA556, bloque abandonado a medias) y `sootland.test.ts`.

## 11. Snapshots

**SNA 48K**: cabecera de 27 bytes y luego 49 152 bytes de RAM (0x4000–0xFFFF).

| Off | Campo |
|---|---|
| 0 | I |
| 1–8 | HL', DE', BC', AF' |
| 9–18 | HL, DE, BC, IY, IX |
| 19 | bit 2 = IFF2 |
| 20 | R |
| 21–24 | AF, SP |
| 25 | IM |
| 26 | Borde |

El PC está en la pila: al cargar se hace `POP PC`; al guardar se hace `PUSH PC` (si eso
corrompe RAM útil es una limitación conocida del formato).

**Z80 v1/v2/v3**: cabecera de 30 bytes; si PC (off 6) ≠ 0 es v1 (48K, posible compresión
`ED ED nn bb` con marcador final `00 ED ED 00`). Si PC = 0, cabecera extendida (longitud en
off 30: 23 = v2, 54/55 = v3) y bloques de memoria por página (48K: páginas 8 → 0x4000,
4 → 0x8000, 5 → 0xC000; longitud 0xFFFF = sin comprimir).

Reglas de carga del núcleo (`snap.c`, fijadas por `tests/core/snap/snap.test.ts`):
- `len` > `ZX_IO_BUFFER_SIZE` → `ZX_ERR_SIZE` (el fichero sólo puede estar en el buffer).
- v1 comprimido: tras los datos no puede ir nada o exactamente `00 ED ED 00`.
- v2/v3: cada página 48K comprimida debe expandirse a 16 384 bytes exactos consumiendo
  todo su bloque; un bloque de longitud 0 no cuenta como página. Páginas ajenas (ROM,
  IF1, MGT) se ignoran; repetidas o ausentes → `ZX_ERR_FORMAT`.
- Las cargas no tocan `zx.t` (posición en el frame): SNA no la guarda y la de Z80 v3
  se ignora; moverla descuadraría el render perezoso.
- `zx_load_z80` fija el Issue por el bit 2 del byte 29 (emulación Issue 2), como Fuse.
- SNA y Z80 dejan a reposo lo que no guardan: MEMPTR = 0, Q = 0, halted = 0,
  ei_delay = 0 (EI o prefijo pendiente), ld_air = 0; el PC se fija con `zx_set_pc`.

## 12. Audio (beeper)

- Nivel de salida en función de EAR (bit 4) y MIC (bit 3) del último OUT 0xFE. Niveles
  de Fuse 1.6.0 (`peripherals/ula.c` `ula_write` → `sound_beeper`; `sound.c`
  `beeper_ampl[]` con AMPL_BEEPER = 50·256 y AMPL_TAPE = 2·256; en Fuse MIC suma cuando
  el bit 3 vale 0 y, sin cinta sonando, MIC solo se fuerza a silencio):
  EAR/MIC = 0/0 → 0, 0/1 → 0, 1/0 → 52, 1/1 → 50, normalizados por 52 (`audio.c`).
- `[VERIFICAR]` MIC: la tabla de tensiones medidas en la salida (48K Technical
  Reference, puerto 0xFE: EAR/MIC 0/0 ≈ 0,39 V, 0/1 ≈ 0,73 V, 1/0 ≈ 3,66 V,
  1/1 ≈ 3,79 V) dice que MIC a 1 sube el nivel, al revés que Fuse. Se mantienen los
  niveles de Fuse hasta contrastarlo con una medida o con `ula_filter.c` del Fuse actual.
- El núcleo registra `(t_state, nivel)` en cada cambio. Al final del frame se integra el
  nivel por cada periodo de muestra (filtro caja = sin aliasing grueso) y se aplican un
  bloqueo de DC de 1 polo a 25 Hz y un paso bajo de 1 polo a 7 kHz (respuesta del
  altavoz), con su estado arrastrado entre frames.
- El reloj maestro de la emulación es el **audio** (50,08 Hz no coincide con 60 Hz de
  pantalla): el AudioWorklet pide muestras y el bucle produce frames para mantener el
  buffer en su nivel objetivo.

## 13. ROM

`48.rom` (16 384 bytes), copyright Amstrad. Amstrad autoriza su distribución para uso
en emuladores sin ánimo de lucro, conservando el mensaje de copyright. Se obtiene de la
distribución de Fuse (`fuse-emulator-roms` / repositorio de Fuse). Verificar
tamaño 16384 y CRC/SHA conocido antes de usarla.
