/*
 * tape.c — cinta TAP y carga rápida por trampa en LD-BYTES (docs §10).
 *
 * STUB DE FASE 0. Lo sustituye M3 (PLAN.md).
 */
#include "machine.h"

void tape_reset(void) {}

int tape_trap(void) { return 0; }

int tape_ear_bit(uint32_t t)
{
    (void)t;
    return -1;
}

void tape_end_frame(uint32_t frame_len) { (void)frame_len; }

int zx_load_tap(uint32_t len)
{
    (void)len;
    return ZX_ERR_FORMAT;
}
