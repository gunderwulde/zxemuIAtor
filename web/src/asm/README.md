# Ensamblador Z80 (A1)

TypeScript puro, sin DOM, determinista. Dos pasadas. La tabla de instrucciones está en
`../z80isa/` y la comparte el desensamblador (D1).

```ts
import { assemble } from "./asm";
const r = assemble(source, { org: 0x8000, include: (path, from) => text | undefined });
```

## Salida (AGENTS.md §5.3, con estos detalles)

| Campo | Contenido |
|---|---|
| `segments: {addr, bytes: Uint8Array}[]` | Tramos contiguos de memoria escrita, ordenados por dirección (dos ORG que se tocan salen como un solo tramo). |
| `entry: number` | `END expr` o `ENT [expr]`; si no hay, la dirección del primer byte emitido; si no se emite nada, `opts.org`. |
| `symbols: Map<string, number>` | Todos los símbolos. Las locales con su nombre completo `global.local`; las de macros, `macro@N.local`. |
| `lineMap: {addr, line, len, file?}[]` | Una entrada por sentencia que emite bytes. `line` es 1-based; en expansiones de macro es la línea de la llamada (una entrada por instrucción interna). `file` sólo en ficheros de INCLUDE. |
| `errors: {line, col, msg, severity, file?}[]` | `severity` = `"error"` o `"warning"`. `line` y `col` 1-based. Dentro de una macro, `line:col` es la llamada y el mensaje dice `en macro 'x': …`. Ordenados por fichero, línea y columna; máximo `opts.maxErrors` (500). |

Hay bytes en `segments` aunque haya errores (con 0 donde no se pudo calcular): la UI
decide si los usa.

Opciones: `org` (dirección inicial sin ORG, por defecto `0x8000`), `include`
(resolvedor de INCLUDE; sin él, INCLUDE es un error), `defines` (símbolos
predefinidos), `maxErrors`.

## Sintaxis

- Una sentencia por línea: `[etiqueta[:]] [operación [operandos]] [; comentario]`.
- **Etiquetas**: en columna 0 con o sin `:`; sangradas, con `:` (o sin él delante de
  `EQU`/`=`/`:=`/`DEFL`/`MACRO`). Una palabra en columna 0 que es mnemónico o directiva
  y no lleva `:` se toma como instrucción. Las etiquetas distinguen mayúsculas.
- **Locales** `.x`: se guardan como `<última global>.x`; se puede referenciar `glob.x`
  desde cualquier sitio. Dentro de una macro, `.x` es local a cada expansión (sin
  colisiones); si no existe ahí, se busca en la global actual (así una macro puede
  recibir `.x` como argumento). `.@x` es siempre la local de la global actual (sjasm).
- **Mnemónicos y registros** sin distinguir mayúsculas. Alias: `IXH/IXL/IYH/IYL` =
  `XH/XL/YH/YL` = `HX/LX/HY/LY`; `SLL` = `SL1` = `SLI`; `ex af,af` = `ex af,af'` = `exa`;
  `jp hl/ix/iy` = `jp (hl)…`; `in (c)` = `in f,(c)`; `add b` = `add a,b` y `sub a,b` =
  `sub b` (las 8 ALU); `(ix)` = `(ix+0)`.
- **DDCB/FDCB no documentadas**: `rlc (ix+d),b`, `res 3,(iy-1),a` y la forma de
  Sean Young `ld b,rlc (ix+d)`, `ld a,set 7,(ix+d)`.
- **Números**: `255`, `#FF`, `$FF`, `0xFF`, `0FFh`, `%1010`, `0b1010`, `1010b`, `17o`/`17q`,
  `99d`. Los ceros a la izquierda no son octal (`010` = 10). `$` solo = dirección de la
  sentencia actual.
- **Caracteres**: `'A'`, `"A"`, y de dos caracteres (`'AB'` = 4142h). En `"…"` hay
  escapes C (`\n \r \t \0 \\ \" \' \a \b \e \f \v \xHH`); en `'…'` el texto es literal y
  `''` es una comilla.
- **Expresiones** (32 bits con signo), de menor a mayor precedencia: `||`, `&&`,
  `|`/`OR`, `^`/`XOR`, `&`/`AND`, `== = != <>`/`EQ NE`, `< <= > >=`/`LT LE GT GE`,
  `<< >>`/`SHL SHR`, `+ -`, `* / %`/`MOD`, unarios `- + ~ ! NOT HIGH LOW`. Comparaciones
  y `!` dan 1 o 0. `HIGH x`/`LOW x` también con paréntesis.

## Directivas

| Directiva | Notas |
|---|---|
| `ORG n` | |
| `x EQU e`, `x = e`, `x := e`, `x DEFL e` | EQU no se puede redefinir; `=`, `:=`, `DEFL` sí. EQU admite referencias hacia delante. |
| `DB/DEFB/BYTE/DEFM/DM`, `DZ` (+0), `DC` (bit 7 en el último carácter) | Cadenas y expresiones mezcladas. Aviso si un valor no cabe en un byte (-128..255). |
| `DW/DEFW/WORD` | Aviso fuera de -32768..65535. |
| `DS/DEFS/BLOCK n[,relleno]` | Emite `n` bytes (relleno 0 por defecto). |
| `ALIGN n[,relleno]` | Rellena hasta múltiplo de `n`. |
| `END [entrada]`, `ENT [dir]` | Lo que sigue a END se ignora. |
| `nombre MACRO p1,p2` / `MACRO nombre p1,p2` … `ENDM`/`ENDMACRO` | Parámetros por nombre (sustitución textual de identificadores completos, fuera de cadenas). `p:valor` da valor por defecto (sjasm). `LOCAL a,b` y `&a` (M80). Argumentos `<a,b>` agrupan texto con comas. Se invoca por su nombre. Sin macros anidadas en la definición; hasta 64 niveles de expansión. |
| `REPT n`/`DUP n`/`REPEAT n` … `ENDR`/`EDUP`/`ENDREPEAT` | `@#` = número de iteración (sjasm). |
| `IF e` / `ELSEIF e` / `ELSE` / `ENDIF`, `IFDEF x`, `IFNDEF x`, `IFIDN a,b`, `IFDIF a,b` | Anidables. IFIDN compara texto (útil en macros). |
| `INCLUDE fichero` | Con `opts.include`. |
| `ERROR "msg"` | Error de usuario. |
| `ASEG`, `TITLE`, `.TITLE`, `DEVICE`, `.Z80`, … | Se ignoran. |

Las directivas admiten un punto delante (`.org`, `.db`).

## Reglas de las dos pasadas

Los valores que deciden el recorrido o el tamaño (`IF`, `ELSEIF`, `IFDEF`, `ORG`, `DS`,
`ALIGN`, `REPT`) se calculan en la pasada 1 y la 2 reutiliza el mismo valor, de modo que
las dos pasadas no pueden divergir. Por eso esos valores no admiten referencias hacia
delante (error con línea y columna). El tamaño de una instrucción sólo depende de la
forma de sus operandos, nunca de su valor. La pasada 2 reutiliza también el análisis de
cada línea de la 1.

## Errores

Se informan todos los de la pasada (no se aborta al primero): símbolo indefinido o
duplicado, operandos no válidos, salto relativo JR/DJNZ fuera de -128..127,
desplazamiento `(IX+d)` fuera de -128..127, número mal formado, cadena sin cerrar,
paréntesis, IF/ENDIF y MACRO/ENDM desparejados, código más allá de FFFFh. Avisos:
truncado de byte/palabra y zonas sobrescritas por dos ORG.

## Para el desensamblador (D1)

`Z80_ISA` es un array de entradas `{ mnemonic, operands, text, template, length, prefix,
opcode, undoc, dup }`. `template` son los bytes con marcadores `OP_N`, `OP_NN` (2 bytes,
little endian), `OP_D` (desplazamiento con signo) y `OP_E` (relativo). Cada patrón de
bytes literales es único, así que basta indexar por prefijo (`""`, `cb`, `ed`, `dd`,
`fd`, `ddcb`, `fdcb`) y `opcode` (en DDCB/FDCB es el byte tras el desplazamiento).
Las entradas `dup` son codificaciones alternativas (ED 4C = `neg`, ED 63 = `ld (nn),hl`,
DDCB `bit` con z≠6…): el ensamblador emite siempre la canónica, así que un
`ensamblar(desensamblar(x)) == x` para ellas necesita que D1 las emita como `db`. No
están en la tabla: DD/FD delante de un opcode que no usa HL (el prefijo no hace nada) y
los ED no asignados (NOP de 8 T); D1 los trata aparte.

## Verificación

`tests/asm/`: ZEXDOC y ZEXALL ensamblados desde su fuente idénticos byte a byte al
`.com` publicado; los 7 programas de z80test 1.2a (sintaxis sjasm) idénticos al `.tap`;
tabla de referencia escrita a mano (Zilog + Sean Young); directivas, macros, errores y
rendimiento.
