# ABI de C para Z80 (K1)

Contrato entre el compilador (`web/src/cc`), la librería (`web/src/clib`, L1), el código
en ensamblador escrito a mano y la UI. El compilador genera **fuente** para nuestro
ensamblador (A1, `web/src/asm/README.md`), así que todo lo que sigue se expresa en esa
sintaxis.

## 1. Tipos y layout

| Tipo | Tamaño | Notas |
|---|---|---|
| `char` | 1 | **sin signo** por defecto (0..255) |
| `signed char` / `unsigned char` | 1 | |
| `short`, `int`, `signed`, `unsigned` (y combinaciones) | 2 | little endian (byte bajo primero) |
| `enum` | 2 | como `int` |
| punteros `T *` | 2 | |
| `T a[n]` | `n*sizeof(T)` | contiguo; multidimensional en orden de filas |
| `struct` | suma de los campos | **sin relleno**: el Z80 no tiene alineación; campos en orden de declaración, cada uno en `offset` = suma de los anteriores |

No hay `long`, `float`, `double`, `union`, bitfields ni punteros a función (v1).
Excepción: el **nombre de una función usado como valor** (`f` o `&f`, fuera de una
llamada) da su dirección (`ld hl,_f`) con tipo `void *` (convertible a cualquier
puntero o entero); sirve para pasar rutinas a la librería (`im2_install(mi_isr)`). No se
puede llamar a través de ella desde C. La función cuenta como usada (no se elimina).
Promociones enteras de C con `int` de 16 bits: `char`, `signed char`, `unsigned char` y
`enum` se promocionan a `int` (con signo, sin pérdida); `int` + `unsigned` → `unsigned`.
Los resultados de comparaciones y de `! && ||` son `int` 0 o 1.

## 2. Símbolos

- Todo símbolo C global (función o variable, `extern` o no) se llama en ensamblador
  `_nombre` (`main` → `_main`, `printf` → `_printf`).
- Los `static` de fichero se llaman `_nombre` si no chocan con otro global; si dos ficheros
  tienen el mismo `static`, el segundo y siguientes se renombran `__sN_nombre` (N = índice
  del fichero). Los `static` locales: `__sl_función_nombre_N`.
- Etiquetas internas de una función: locales del ensamblador (`.lN`, que A1 guarda como
  `_función.lN`). Cadenas literales: `__strN`.
- Todo lo que empieza por `__` (dos subrayados) está reservado al compilador, al crt0 y
  al runtime. La librería (L1) usa nombres C normales o, para lo interno, `__zx_…`.

## 3. Convención de llamada

1. El llamador evalúa los argumentos y los **apila de derecha a izquierda**, cada uno
   como **una palabra de 16 bits** (`push hl`). Los de 8 bits se promocionan a `int`
   antes de apilarse (el byte alto es la extensión de signo/cero, pero el llamado sólo
   debe fiarse del byte bajo si el parámetro es `char`).
2. `call _f`.
3. **El llamador limpia la pila** (`pop` de cada argumento o `ld hl,2n / add hl,sp /
   ld sp,hl`). Por eso las funciones **variádicas** (`int printf(const char *fmt, ...)`)
   funcionan sin más: se pueden declarar, definir y llamar; los argumentos variables van
   con las promociones por defecto (`char` → `int`).
4. Retorno: 8 bits en **L** (H indefinido), 16 bits en **HL**. `void`: nada.
5. Structs por valor (como argumento o retorno): **no admitidos** en v1 (error de
   compilación). Se pasan por puntero. La asignación `a = b` entre structs sí.

### Registros

| Registro | Quién lo conserva |
|---|---|
| **IX** | el llamado (es el puntero de marco) |
| **IY** | **nadie lo toca nunca**: vale `5C3Ah` (ERR_NR), la ROM lo necesita en la INT de IM 1 (KEYBOARD) y en RST 10h, CHAN-OPEN, etc. |
| **SP** | equilibrado al volver |
| **H'L'** (alternativo) | el llamado, si usa `EXX`. Volver a BASIC con H'L' cambiado cuelga el intérprete. El código C nunca usa el juego alternativo. |
| AF, BC, DE, HL, A'F', B'C', D'E' | se pueden destruir |

Estado del procesador: el código C no ejecuta `DI`/`EI`/`IM`; las interrupciones siguen
como las dejó BASIC (IM 1, EI). Una rutina de librería que instale IM 2 debe dejar IY
intacto y restaurar IM 1 antes de volver a BASIC.

### Marco de pila (función normal)

```
_f:     push ix
        ld ix,0
        add ix,sp          ; IX = marco
        ld hl,-N           ; N = bytes de variables locales (si N > 0)
        add hl,sp
        ld sp,hl
        ...                ; cuerpo; valor de retorno en HL / L
        ld sp,ix
        pop ix
        ret
```

| Dirección | Contenido |
|---|---|
| `(ix+4)`, `(ix+5)` | 1.er argumento (byte bajo, alto) |
| `(ix+6)`, `(ix+7)` | 2.º argumento, y así de 2 en 2 |
| `(ix+2)`, `(ix+3)` | dirección de retorno |
| `(ix+0)`, `(ix+1)` | IX del llamador |
| `(ix-1)` … `(ix-N)` | variables locales |

Una función sin parámetros ni locales puede no montar marco (el compilador lo omite).
Si un desplazamiento no cabe en −128..127 el compilador calcula la dirección
(`push ix / pop hl / ld de,d / add hl,de`); no hay límite práctico de locales.

### Funciones en ensamblador

Se declaran en un `.h` con un prototipo C normal y se definen de una de dos formas:

**a) Función `__naked`** en un `.c`: el compilador no emite prólogo, epílogo ni `ret`.
Al entrar, `(sp)` = retorno, `(sp+2)` = 1.er argumento, `(sp+4)` = 2.º…

```c
unsigned char peek(unsigned int addr) __naked {
__asm
        pop de          ; retorno
        pop hl          ; addr
        push hl         ; la pila la limpia el llamador: se deja como estaba
        push de
        ld l,(hl)
        ret
__endasm;
}
```

**b) `__asm … __endasm;` a nivel de fichero** con la etiqueta `_nombre:` escrita a mano.
El texto se copia tal cual en la sección de código.

El código de librería puede ser también un fichero `.asm` enlazado con
`#pragma link "fichero.asm"` (ver §6). Una función con prototipo y sin cuerpo C se da
por externa (definida en ensamblador): ni error ni aviso del compilador; si no existe,
el error lo da el ensamblador (símbolo indefinido). Un `.asm` enlazado se copia entero.

API: `compile(files: Map<string, string>, opts: { main: string, org?: number,
includeResolver?: (name: string, from: string) => string | undefined })` en
`web/src/cc/index.ts`. `#include "x"` busca primero en `files` y luego en el resolvedor;
`#include <x>` al revés. `#pragma link` igual que `<x>`.

### Funciones variádicas escritas en C

Los argumentos están contiguos en la pila, de 2 en 2 bytes, tras el último fijo:

```c
int printf(const char *fmt, ...) {
    int *ap = (int *)(&fmt + 1);   /* 1.er argumento variable; ap++ para el siguiente */
    ...
}
```

Es el único "varargs" de v1 (no hay `<stdarg.h>`); vale para la librería.

## 4. Runtime (helpers)

Los emite el compilador sólo si se usan. Convención propia (no la de C): operandos en
**HL** (izquierdo) y **DE** (derecho), resultado en **HL**; destruyen AF, BC, DE;
conservan IX, IY y el juego alternativo.

| Helper | Operación |
|---|---|
| `__mul16` | HL = HL × DE (16 bits bajos; vale con y sin signo) |
| `__divu16` | HL = HL / DE sin signo (DE = 0 → HL = FFFFh) |
| `__modu16` | HL = HL % DE sin signo (DE = 0 → HL = HL) |
| `__divs16` | HL = HL / DE con signo, truncando hacia cero (C99) |
| `__mods16` | HL = HL % DE con signo; el signo del resto es el del dividendo (C99) |
| `__shl16` | HL = HL << E (E ≥ 16 → 0) |
| `__shru16` | HL = HL >> E lógico |
| `__shrs16` | HL = HL >> E aritmético |

El código de librería en ensamblador puede llamarlos (`call __mul16`) si el programa los
usa; si no está seguro, que los implemente él (no hay enlazador que los arrastre).

## 5. Secciones y orden

El compilador produce un único fuente de ensamblador (todo el programa a la vez:
fichero principal, otros `.c` del proyecto y fuentes enlazadas por `#pragma link`):

```
        org ORG             ; opts.org, por defecto 8000h
        crt0                ; __start
        código              ; funciones (sólo las alcanzables desde main) + helpers
        rodata              ; cadenas literales y globales const
        data                ; globales y static con inicializador
__bss_start:                ; BSS: sólo etiquetas (EQU), no ocupa bytes en el binario
        _x equ __bss_start+0 ...
__bss_end equ __bss_start+tamaño
        end __start
```

- La BSS (globales y `static` sin inicializador) **no se emite**: son símbolos tras el
  final del binario; el crt0 la pone a cero en cada ejecución. Los inyectores y el TAP
  sólo ven código + rodata + data.
- Data: se inyecta en cada "Ejecutar". En un TAP ejecutado dos veces (`RANDOMIZE USR`
  repetido) los globales inicializados conservan lo que dejó la ejecución anterior (no
  hay copia ROM→RAM).

## 6. crt0

```
__start:
        exx
        push hl             ; H'L' de BASIC (hay que devolverlo intacto)
        exx
        ld (__crt_sp),sp    ; para exit()
        ; BSS a cero (sólo si hay BSS)
        ld hl,__bss_start
        ld de,__bss_start+1
        ld bc,TAMAÑO-1
        ld (hl),0
        ldir
        call _main
__crt_exit:                 ; HL = código de salida
        ld sp,(__crt_sp)
        exx
        pop hl
        exx
        im 1                ; por si la librería dejó IM 2 puesto (BASIC siempre va en IM 1)
        ld b,h              ; USR devuelve BC a BASIC: PRINT USR 32768 imprime
        ld c,l              ; el valor de retorno de main
        ret                 ; a BASIC (o al trampolín de I1), con IY intacto
_exit:                      ; void exit(int code): vuelve a BASIC desde cualquier punto
        pop de
        pop hl
        jr __crt_exit
__crt_sp: dw 0
```

- **Pila**: la de BASIC (no se mueve SP). En un 48K con RAMTOP por defecto la pila está
  justo debajo de FF58h: hay ~30 KB entre el final del programa (en 8000h) y la pila.
- `main` puede ser `int main(void)` o `void main(void)`; si devuelve, se vuelve a BASIC
  con su valor en BC. `exit(n)` (declarado por L1 en su cabecera) hace lo mismo desde
  cualquier profundidad.
- `#pragma link "fichero"`: añade al programa (una sola vez) un `.c` (se compila) o un
  `.asm` (se copia en la sección de código). Lo resuelve el mismo `includeResolver` que
  `#include`. Es como la librería de L1 aporta sus fuentes: `zx.h` lleva
  `#pragma link "zx.c"`.

## 7. Ensamblador en línea

```c
__asm
        ld a,2
        out (254),a
__endasm;
```

Válido como sentencia (dentro de una función) o a nivel de fichero. El texto entre
`__asm` y `__endasm` se copia tal cual (sin preprocesar) en su sitio. Dentro de una
función normal los parámetros están en `(ix+4)…` (§3) y los globales son `_nombre`. El
bloque debe conservar IX, IY y SP (y H'L' si hace `EXX`); puede destruir el resto
(el compilador no guarda nada en registros entre sentencias).

## 8. Depuración (cLineMap)

`compile()` devuelve `cLineMap: {file, line, asmLine}[]`: la primera línea del
ensamblador generado (1-based) de cada sentencia C. El `lineMap` del ensamblador da la
dirección de cada línea del ensamblador, así que PC → línea de ensamblador → línea C.
Detalles en `web/src/cc/README.md`.
