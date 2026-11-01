/*
 * debug.c — breakpoints. El mapa de bits se consulta en machine.h (debug_is_bp);
 * con debug_bp_count == 0 la comprobación es un único test por instrucción.
 */
#include "machine.h"

uint8_t  debug_bp_map[65536 / 8];
uint32_t debug_bp_count;

void zx_bp_set(uint32_t addr, uint32_t on)
{
    addr &= 0xFFFF;
    uint8_t bit = (uint8_t)(1u << (addr & 7));
    uint8_t *cell = &debug_bp_map[addr >> 3];
    if (on && !(*cell & bit)) {
        *cell |= bit;
        debug_bp_count++;
    } else if (!on && (*cell & bit)) {
        *cell &= (uint8_t)~bit;
        debug_bp_count--;
    }
}

void zx_bp_clear_all(void)
{
    zx_memset(debug_bp_map, 0, sizeof debug_bp_map);
    debug_bp_count = 0;
}
