/*
 * base.h — utilidades comunes del núcleo (sin libc).
 */
#ifndef BASE_H
#define BASE_H

#include "../include/zx.h"

/* Con -mbulk-memory, clang traduce estos builtins a memory.copy / memory.fill. */
#define zx_memcpy(d, s, n) __builtin_memcpy((d), (s), (n))
#define zx_memset(d, v, n) __builtin_memset((d), (v), (n))

/* Activas con -DZX_DEBUG (builds de test); desaparecen en producción. */
#ifdef ZX_DEBUG
#define ZX_ASSERT(c) do { if (!(c)) __builtin_trap(); } while (0)
#else
#define ZX_ASSERT(c) ((void)0)
#endif

#endif /* BASE_H */
