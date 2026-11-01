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
  la acepta en esa ventana, se pierde.
- Bus de datos durante INTA: 0xFF (IM2 lee el vector en `(I*256 + 0xFF)`).
- Aceptación: IM0/IM1 → 13 T (IM1 = RST 38h); IM2 → 19 T. Incrementa R.
- EI: la interrupción no se acepta hasta **después** de la instrucción siguiente a EI.
- Cadenas de prefijos DD/FD: no se acepta INT entre prefijo e instrucción.
- `LD A,I` / `LD A,R`: P/V = IFF2. Bug NMOS: si se acepta una INT justo tras ellas, P/V queda a 0.
- HALT: repite ciclos M1 sobre la dirección siguiente (PC no avanza) hasta INT/NMI; cada
  ciclo es contendido si PC está en 0x4000–0x7FFF.

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
- Un `OUT (0xFE)` que **termina** en T 14339–14342 cambia el borde en la posición del
  byte 16384. A partir de ahí: 4 T = 8 píxeles, 224 T = 1 línea.
- El borde se muestrea en unidades de 8 píxeles (4 T) → no hay cambios de borde
  más finos que eso en 48K. `[VERIFICAR]` alineación exacta con Fuse.
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
pantalla siempre 0xFF. Los T exactos de cada lectura: `[VERIFICAR]` con Fuse
(`spectrum_unattached_port`); se fija con los tests de floating bus de la comunidad.

Snow (I en 0x40–0x7F): fuera de alcance (decisión del usuario).

## 9. Z80: detalles no documentados obligatorios

- Flags XF (bit 3) e YF (bit 5): copiados del resultado o de fuentes específicas por
  instrucción (BIT n,(HL) usa MEMPTR alto; bloque LDI/CPI/INI/OUTI tienen reglas propias).
- **MEMPTR (WZ)**: registro interno, visible vía `BIT n,(HL)`. Reglas completas en la fuente 4.
- **Q**: SCF/CCF calculan XF/YF como `((Q ^ F) | A) & 0x28`, donde Q = F si la
  instrucción anterior modificó flags, si no 0 (variante Zilog NMOS).
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

Carga rápida: trampa en la rutina ROM **LD-BYTES (0x0556)**. Entrada: IX = destino,
DE = longitud, A = flag esperado, CF = 1 cargar / 0 verificar. Salida: CF = 1 si OK.
Se copia el bloque, se ajustan IX/DE/AF/flags como lo dejaría la ROM y se ejecuta un
RET. `[VERIFICAR]` estado exacto de salida con `tape.c` de Fuse.

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

## 12. Audio (beeper)

- Nivel de salida en función de EAR (bit 4) y MIC (bit 3) del último OUT 0xFE. EAR
  domina; MIC añade un nivel pequeño. Niveles relativos `[VERIFICAR]` con Fuse.
- El núcleo registra `(t_state, nivel)` en cada cambio. Al final del frame se integra el
  nivel por cada periodo de muestra (filtro caja = sin aliasing grueso) y se aplica
  bloqueo de DC + paso bajo suave (respuesta del altavoz).
- El reloj maestro de la emulación es el **audio** (50,08 Hz no coincide con 60 Hz de
  pantalla): el AudioWorklet pide muestras y el bucle produce frames para mantener el
  buffer en su nivel objetivo.

## 13. ROM

`48.rom` (16 384 bytes), copyright Amstrad. Amstrad autoriza su distribución para uso
en emuladores sin ánimo de lucro, conservando el mensaje de copyright. Se obtiene de la
distribución de Fuse (`fuse-emulator-roms` / repositorio de Fuse). Verificar
tamaño 16384 y CRC/SHA conocido antes de usarla.
