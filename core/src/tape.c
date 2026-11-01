/*
 * tape.c — cinta TAP y carga rápida por trampa en LD-BYTES (docs §10).
 *
 * STUB DE FASE 0. Lo sustituye M3 (PLAN.md).
 */
#include "machine.h"

void tape_reset(void) {}

int tape_trap(void) { return 0; }

int zx_load_tap(uint32_t len)
{
    (void)len;
    return ZX_ERR_FORMAT;
}
