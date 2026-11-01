/*
 * testbus.c — máquina de test: 64 KB planos, sin contención, con registro de eventos
 * de bus en el formato de FUSE. Implementa bus.h e incluye z80.c (unity build).
 * Sólo para core-test.wasm (docs/TEST-PLAN.md §1).
 */
#include "../include/testbus.h"
#include "bus.h"

static uint8_t    mem[65536];
static ZxRegs     cpu;
static uint32_t   t;
static uint8_t    int_active, int_data = 0xFF;
static ZxBusEvent events[ZX_BUSLOG_MAX];
static uint32_t   event_count;
static uint8_t    log_on = 1;
static uint8_t    port_queue[TB_PORT_QUEUE_MAX];
static uint32_t   port_queue_len, port_queue_pos;

static inline void log_event(uint8_t kind, uint16_t addr, uint8_t value)
{
    if (log_on && event_count < ZX_BUSLOG_MAX)
        events[event_count++] = (ZxBusEvent){ t, addr, kind, value };
}

static inline uint8_t bus_read(uint16_t a, uint32_t n)
{
    log_event(ZX_EV_MC, a, 0);
    t += n;
    log_event(ZX_EV_MR, a, mem[a]);
    return mem[a];
}

static inline void bus_write(uint16_t a, uint8_t v, uint32_t n)
{
    log_event(ZX_EV_MC, a, 0);
    t += n;
    log_event(ZX_EV_MW, a, v);
    mem[a] = v;
}

static inline void bus_contend(uint16_t a, uint32_t n)
{
    log_event(ZX_EV_MC, a, 0);
    t += n;
}

static inline void bus_tick(uint32_t n)
{
    t += n;
}

static inline uint8_t bus_in(uint16_t port)
{
    uint8_t v = port_queue_pos < port_queue_len ? port_queue[port_queue_pos++] : (uint8_t)(port >> 8);
    t += 1;
    log_event(ZX_EV_PR, port, v);
    log_event(ZX_EV_PC, port, 0);
    t += 3;
    return v;
}

static inline void bus_out(uint16_t port, uint8_t v)
{
    t += 1;
    log_event(ZX_EV_PW, port, v);
    log_event(ZX_EV_PC, port, 0);
    t += 3;
}

static inline int     bus_int_line(void) { return int_active; }
static inline uint8_t bus_int_data(void) { return int_data; }

#include "z80.c"

void tb_reset(void)
{
    zx_memset(mem, 0, sizeof mem);
    z80_power_on(&cpu);
    t = 0;
    int_active = 0;
    int_data = 0xFF;
    event_count = 0;
    port_queue_len = port_queue_pos = 0;
}

uint8_t    *tb_mem(void)                 { return mem; }
ZxRegs     *tb_regs(void)                { return &cpu; }
uint32_t    tb_tstates(void)             { return t; }
void        tb_set_tstates(uint32_t v)   { t = v; }
void        tb_step(void)                { z80_step(&cpu); }
void        tb_set_int(uint32_t active)  { int_active = active != 0; }
void        tb_set_int_data(uint32_t v)  { int_data = (uint8_t)v; }
void        tb_nmi(void)                 { z80_nmi(&cpu); }
ZxBusEvent *tb_events(void)              { return events; }
uint32_t    tb_event_count(void)         { return event_count; }
uint8_t    *tb_port_queue(void)          { return port_queue; }

uint32_t tb_run(uint32_t until)
{
    while (t < until)
        z80_step(&cpu);
    return t;
}

void tb_log_enable(uint32_t on)
{
    log_on = on != 0;
    event_count = 0;
}

void tb_port_queue_set(uint32_t n)
{
    port_queue_len = n > TB_PORT_QUEUE_MAX ? TB_PORT_QUEUE_MAX : n;
    port_queue_pos = 0;
}
