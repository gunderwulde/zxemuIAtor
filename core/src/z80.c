/*
 * z80.c — CPU Z80. Se incluye desde la máquina (zx48.c / testbus.c) DESPUÉS de definir
 * las funciones bus_* de bus.h (unity build). No compilar por separado.
 *
 * STUB DE FASE 0: ejecuta cualquier opcode como NOP. Lo sustituye C1 (PLAN.md).
 */

static void z80_power_on(ZxRegs *r)
{
    zx_memset(r, 0, sizeof *r);
    r->af.w = 0xFFFF;
    r->sp.w = 0xFFFF;
}

static void z80_step(ZxRegs *r)
{
    (void)bus_read(r->pc.w, 4);
    r->pc.w++;
    r->r = (uint8_t)((r->r & 0x80) | ((r->r + 1) & 0x7F));
}

static void z80_nmi(ZxRegs *r)
{
    (void)r;
}
