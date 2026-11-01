# web/src/cc — compilador C → Z80 (K1)

Genera **fuente de ensamblador** para el ensamblador de A1 (`web/src/asm`). La ABI
(convención de llamada, marco, nombres, secciones, crt0, helpers) está en
[docs/c-abi.md](../../../docs/c-abi.md).

## API

```ts
import { compile } from "./cc";

const r = compile(files, { main: "main.c" });
// files: Map<nombre, texto>  (todos los .c se compilan juntos, salvo onlyMain)
// r.asm       fuente lista para assemble(); termina en "end __start"
// r.errors    Array<{file, line, col, msg, severity: "error" | "warning"}>
// r.cLineMap  Array<{file, line, asmLine}>
// r.emitted / r.removed   (diagnóstico) líneas de asm antes del peephole / quitadas por él
```

Opciones (`CcOptions`):

| Opción | Por defecto | Qué hace |
|---|---|---|
| `main` | — | Fichero principal (debe definir `main`) |
| `org` | 8000h | Dirección de `org` |
| `includeResolver(name, from)` | ninguno | Devuelve el texto de `#include`/`#pragma link` que no esté en `files` (la librería de L1) o `undefined` |
| `peephole` | `true` | Optimizador de mirilla |
| `onlyMain` | `false` | Compilar sólo `main` y lo que incluya/enlace |

Resolución: `#include "x"` busca primero en `files` y luego en el resolver; `<x>` y
`#pragma link "x"` primero en el resolver y luego en `files`. `#pragma link` de un `.c`
lo compila; de un `.asm` lo copia en la sección de código.

Si hay algún error (no aviso), `asm` es la cadena vacía.

## cLineMap (para U1/D1: PC → línea C)

El codegen deja en `asm` un comentario `; fichero:línea: texto C` antes del código de
cada línea C. `asmLine` es la línea (1-based) de ese comentario en `r.asm`. Para pasar
a direcciones con el `lineMap` del ensamblador:

```ts
const a = assemble(r.asm);
// dirección de la línea C: primera instrucción tras su comentario
const addrOf = (asmLine: number) => a.lineMap.find((l) => l.line > asmLine)?.addr;
```

Para ir de PC a línea C: la entrada de `cLineMap` con mayor `asmLine` cuya línea de asm
sea ≤ la línea de asm del PC (buscando el PC en `a.lineMap`). Las líneas C sin código
no tienen entrada. Cada línea de un bloque `__asm` tiene su propia entrada.
El orden de `cLineMap` es creciente en `asmLine`.

## Subconjunto

Soportado: `char` (sin signo por defecto), `signed/unsigned char`, `short`/`int`
(16 bits), `unsigned`, punteros, arrays multidimensionales, `struct` (sin relleno),
`typedef`, `enum`, `const`, `static` (fichero y local), globales inicializados,
recursión, todo el control de flujo (`switch` denso → tabla de saltos, disperso →
cadena; `goto`), todos los operadores con promociones C99, cadenas, `sizeof`, casts,
`__asm … __endasm;`, funciones `__naked`, declarar y llamar funciones variádicas.

Fuera: `float`/`double`, `long`, `union`, punteros a función (el nombre de una función
como valor sí da su dirección, `void*`), varargs definidos por el usuario, campos de
bits, `volatile` con semántica (se acepta y se ignora).

## Ficheros

`lexer.ts` → `preproc.ts` → `parser.ts` (AST tipado; análisis semántico al parsear,
`types.ts`) → `codegen.ts` (acumulador HL/A, IX marco) → `peephole.ts` → `index.ts`
(enlace del programa entero, eliminación de funciones muertas, datos, crt0 y helpers de
`runtime.ts`). Tests en `tests/cc/`.
