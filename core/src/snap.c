/*
 * snap.c — snapshots SNA y Z80 v1–v3 (48K) (docs §11).
 *
 * STUB DE FASE 0. Lo sustituye M3 (PLAN.md).
 */
#include "machine.h"

int zx_load_sna(uint32_t len)
{
    (void)len;
    return ZX_ERR_FORMAT;
}

int zx_load_z80(uint32_t len)
{
    (void)len;
    return ZX_ERR_FORMAT;
}

uint32_t zx_save_sna(void) { return 0; }
