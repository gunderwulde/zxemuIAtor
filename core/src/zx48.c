/*
 * zx48.c — máquina ZX Spectrum 48K: memoria, contención, puertos, frame e INT.
 * Implementa bus.h e incluye z80.c (unity build).
 *
 * ESQUELETO DE FASE 0: la tabla de contención está a cero, no hay contención de E/S
 * ni bus flotante. Lo completa M1 (PLAN.md).
 */
#include "machine.h"
#include "bus.h"

Zx48    zx;
uint8_t zx_io[ZX_IO_BUFFER_SIZE];

/* Retardo de contención por T-state del frame (docs §4). El margen cubre las
 * instrucciones que empiezan antes de 69888 y terminan después. */
static uint8_t contention[ZX_TSTATES_PER_FRAME + 256];

static uint8_t bp_skip;    /* 1 = reanudar sobre el breakpoint en el que paramos */

#ifdef ZX_TEST_HOOKS
static ZxBusEvent buslog[ZX_BUSLOG_MAX];
static uint32_t   buslog_len;
static uint8_t    buslog_on;
#define LOG(k, a, v) do { if (buslog_on && buslog_len < ZX_BUSLOG_MAX) \
    buslog[buslog_len++] = (ZxBusEvent){ zx.t, (uint16_t)(a), (uint8_t)(k), (uint8_t)(v) }; } while (0)
#else
#define LOG(k, a, v) ((void)0)
#endif

/* ---- bus.h ---- */

static inline uint32_t is_contended(uint16_t a) { return (a & 0xC000) == 0x4000; }

static inline void contend(uint16_t a)
{
    LOG(ZX_EV_MC, a, 0);
    if (is_contended(a))
        zx.t += contention[zx.t];
}

static inline uint8_t bus_read(uint16_t a, uint32_t t)
{
    contend(a);
    zx.t += t;
    uint8_t v = zx.mem[a];
    LOG(ZX_EV_MR, a, v);
    return v;
}

static inline void bus_write(uint16_t a, uint8_t v, uint32_t t)
{
    contend(a);
    zx.t += t;
    LOG(ZX_EV_MW, a, v);
    if (a < 0x4000)
        return;
    if (a < 0x5B00)
        video_catch_up(zx.t);
    zx.mem[a] = v;
}

static inline void bus_contend(uint16_t a, uint32_t t)
{
    contend(a);
    zx.t += t;
}

static inline void bus_tick(uint32_t t)
{
    zx.t += t;
}

static uint8_t read_fe(uint16_t port)
{
    uint8_t v = 0x1F;
    for (int row = 0; row < 8; row++)
        if (!(port >> (8 + row) & 1))
            v &= zx.keys[row];
    /* Bit 6: la cinta si está sonando; si no, Issue 3 sigue a EAR (bit 4) e Issue 2
     * necesita MIC y EAR a 0. */
    int tape = tape_ear_bit(zx.t);
    uint8_t ear = tape >= 0 ? (uint8_t)tape
                : zx.issue == 2 ? (zx.last_fe & 0x18) != 0 : (zx.last_fe >> 4) & 1;
    return (uint8_t)(v | 0xA0 | ear << 6);
}

static inline uint8_t bus_in(uint16_t port)
{
    /* M1: contención de E/S (docs §5) y bus flotante (docs §8). */
    zx.t += 1;
    uint8_t v = (port & 1) ? 0xFF : read_fe(port);
    LOG(ZX_EV_PR, port, v);
    LOG(ZX_EV_PC, port, 0);
    zx.t += 3;
    return v;
}

static inline void bus_out(uint16_t port, uint8_t v)
{
    /* M1: contención de E/S (docs §5) y T exacto en que la ULA ve el nuevo valor. */
    zx.t += 1;
    LOG(ZX_EV_PW, port, v);
    LOG(ZX_EV_PC, port, 0);
    zx.t += 3;
    if (port & 1)
        return;
    video_catch_up(zx.t);
    audio_out(zx.t, v);
    zx.last_fe = v;
}

static inline int bus_int_line(void)
{
    return zx.int_enabled && zx.t < 32;
}

static inline uint8_t bus_int_data(void)
{
    return 0xFF;
}

#include "z80.c"

/* ---- Bucle ---- */

static void end_frame(void)
{
    video_end_frame();
    audio_end_frame(ZX_TSTATES_PER_FRAME);
    tape_end_frame(ZX_TSTATES_PER_FRAME);
    zx.t -= ZX_TSTATES_PER_FRAME;
    zx.frame++;
}

static int run_one(void)
{
    uint16_t pc = zx.cpu.pc.w;
    if (!bp_skip && debug_is_bp(pc)) {
        bp_skip = 1;
        return ZX_STOP_BREAKPOINT;
    }
    bp_skip = 0;
    if (pc == TAPE_LD_BYTES && tape_trap())
        return ZX_STOP_FRAME;
    z80_step(&zx.cpu);
    return ZX_STOP_FRAME;
}

int zx_run_frame(void)
{
    while (zx.t < ZX_TSTATES_PER_FRAME) {
        int stop = run_one();
        if (stop)
            return stop;
    }
    end_frame();
    return ZX_STOP_FRAME;
}

int zx_step(void)
{
    bp_skip = 1;
    run_one();
    if (zx.t >= ZX_TSTATES_PER_FRAME)
        end_frame();
    return ZX_STOP_STEP;
}

/* ---- Ciclo de vida ---- */

void zx_reset(void)
{
    zx_memset(zx.mem + 0x4000, 0, 0xC000);
    z80_power_on(&zx.cpu);
    zx.t = 0;
    zx.frame = 0;
    zx.last_fe = 0;
    zx_memset(zx.keys, 0x1F, sizeof zx.keys);
    bp_skip = 0;
    video_reset();
    audio_reset();
    tape_reset();
}

void zx_init(void)
{
    zx_memset(&zx, 0, sizeof zx);
    zx.issue = 3;
    zx.int_enabled = 1;
    zx_reset();
}

int zx_load_rom(uint32_t len)
{
    if (len != ZX_ROM_SIZE)
        return ZX_ERR_SIZE;
    zx_memcpy(zx.mem, zx_io, ZX_ROM_SIZE);
    return ZX_OK;
}

void zx_set_issue(uint32_t issue) { zx.issue = issue == 2 ? 2 : 3; }

uint32_t zx_tstate(void)      { return zx.t; }
uint32_t zx_frame_count(void) { return zx.frame; }
uint8_t *zx_framebuffer(void) { return video_framebuffer(); }
uint8_t *zx_ram(void)         { return zx.mem; }
ZxRegs  *zx_regs(void)        { return &zx.cpu; }
uint8_t *zx_io_buffer(void)   { return zx_io; }
uint32_t zx_io_buffer_size(void) { return ZX_IO_BUFFER_SIZE; }

void zx_key(uint32_t row, uint32_t bit, uint32_t down)
{
    if (row > 7 || bit > 4)
        return;
    if (down)
        zx.keys[row] &= (uint8_t)~(1u << bit);
    else
        zx.keys[row] |= (uint8_t)(1u << bit);
}

void zx_poke(uint32_t addr, uint32_t value)
{
    addr &= 0xFFFF;
    if (addr < 0x4000)
        return;
    if (addr < 0x5B00)
        video_catch_up(zx.t);
    zx.mem[addr] = (uint8_t)value;
}

void zx_set_pc(uint32_t addr)
{
    zx.cpu.pc.w = (uint16_t)addr;
    zx.cpu.halted = 0;
    bp_skip = 0;
}

/* ---- Hooks de test ---- */
#ifdef ZX_TEST_HOOKS

void     zx_t_set_tstate(uint32_t t)      { zx.t = t; }
uint32_t zx_t_contention(uint32_t t)      { return t < sizeof contention ? contention[t] : 0; }
void     zx_t_set_int_enabled(uint32_t on) { zx.int_enabled = on != 0; }

int zx_t_run_until(uint32_t t)
{
    while (zx.t < t)
        z80_step(&zx.cpu);
    return ZX_STOP_FRAME;
}

void zx_t_buslog_enable(uint32_t on)
{
    buslog_on = on != 0;
    buslog_len = 0;
}

ZxBusEvent *zx_t_buslog(void)     { return buslog; }
uint32_t    zx_t_buslog_len(void) { return buslog_len; }

#endif
