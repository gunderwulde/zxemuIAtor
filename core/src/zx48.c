/*
 * zx48.c — máquina ZX Spectrum 48K: memoria, contención, puertos, frame e INT (M1).
 * Implementa bus.h e incluye z80.c (unity build).
 *
 * Referencia de timing: Fuse (fuse-emulator, rama master), en concreto
 *   spectrum.c        contend_delay_common, spectrum_unattached_port
 *   peripherals/ula.c ula_contend_port_early/late, ula_write (Issue 2/3)
 *   periph.c          readport / writeport (en qué instante se lee y se escribe)
 *   memory_pages.c    writebyte (instante de la escritura en memoria)
 *   display_dirty.c   display_get_beam_position / display_update_critical
 *   z80/coretest.c    convención de eventos MC/MR/MW/PR/PW/PC de tests.expected
 * Los valores derivados están explicados donde se usan.
 *
 * Instantes en que la ULA "ve" un cambio (decisión de M1, fuente Fuse):
 *  - Escritura en memoria: al FINAL del ciclo de escritura, es decir, tras la
 *    contención y los 3 T (Fuse writebyte: tstates += delay; tstates += 3; y entonces
 *    writebyte_internal → display_dirty). Ese T es el que recibe video_catch_up().
 *  - OUT a un puerto par: tras el primer T del ciclo de E/S (y su contención si el
 *    byte alto es 0x40–0x7F). Fuse writeport: ula_contend_port_early (contención + 1 T),
 *    writeport_internal (borde y beeper con ese tstates), ula_contend_port_late.
 *    Con un OUT (n),A sin contención, el borde cambia 3 T antes del final del OUT.
 *  - IN: el valor (teclado, EAR, bus flotante) se muestrea 1 T antes del final del
 *    ciclo de E/S, tras toda su contención (Fuse readport: early, late, lectura, +1).
 * La regla de render que hace cuadrar ambas cosas con Fuse está en video.c.
 */
#include "machine.h"
#include "bus.h"

Zx48    zx;
uint8_t zx_io[ZX_IO_BUFFER_SIZE];

/* Retardo de contención por T-state del frame (docs §4). El margen cubre las
 * instrucciones que empiezan antes de 69888 y terminan después (la más larga, 23 T,
 * más contenciones, nunca pasa de 256); tras 69888 todo es borde superior del frame
 * siguiente, sin contención, así que el margen vale 0. */
#define CONTENTION_SIZE (ZX_TSTATES_PER_FRAME + 256)
static uint8_t contention[CONTENTION_SIZE];

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

/* ---- Tabla de contención ----
 * Fuse (spectrum.c, contend_delay_common con el patrón 65432100 y offset 1, y
 * line_times[0] = 14336 − 24·224 − 16) da exactamente: en las 192 líneas de pantalla,
 * los 128 T que empiezan en 14335 + 224·línea tienen retardo 6,5,4,3,2,1,0,0 según
 * (t − inicio) mod 8; el resto, 0. Es la tabla de docs §4. */
static void build_contention(void)
{
    static const uint8_t pattern[8] = { 6, 5, 4, 3, 2, 1, 0, 0 };
    zx_memset(contention, 0, sizeof contention);
    for (uint32_t line = 0; line < 192; line++) {
        uint32_t start = 14335 + line * ZX_TSTATES_PER_LINE;
        for (uint32_t i = 0; i < 128; i++)
            contention[start + i] = pattern[i & 7];
    }
}

/* ---- bus.h ---- */

/* 0x4000–0x7FFF comparte bus con la ULA (docs §3). Para la E/S cuenta igual el byte
 * alto del puerto: la ULA ve esa dirección en el bus y frena al Z80 (docs §5). */
static inline uint32_t is_contended(uint16_t a) { return (a & 0xC000) == 0x4000; }

static inline void contend(uint16_t a)
{
    LOG(ZX_EV_MC, a, 0);
    ZX_ASSERT(zx.t < CONTENTION_SIZE);
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
        return;                     /* ROM: la escritura se pierde */
    if (a < 0x5B00)
        video_catch_up(zx.t);       /* la ULA ve el byte nuevo desde el final del ciclo */
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

/* Contención de E/S en un instante: igual que la de memoria, sin evento MC. Los
 * eventos PC siguen a Fuse coretest.c: se registran ANTES de aplicar la contención,
 * y sólo en los puntos donde Fuse la consulta. */
static inline void io_contend(uint16_t port)
{
    (void)port;
    LOG(ZX_EV_PC, port, 0);
    ZX_ASSERT(zx.t < CONTENTION_SIZE);
    zx.t += contention[zx.t];
}

/* Teclado como matriz eléctrica (docs §6): cada semifila seleccionada (bit a 0 del
 * byte alto) tira a 0 las columnas unidas a ella por teclas pulsadas, y una columna
 * baja también tira de las demás filas que tengan pulsada una tecla en esa columna.
 * El 48K no tiene diodos por tecla, así que tres teclas en las esquinas de un
 * rectángulo cierran el camino hasta la cuarta (ghosting). Se calcula el cierre
 * transitivo filas↔columnas; con ninguna tecla pulsada (lo normal) sale enseguida. */
static uint8_t read_keyboard(uint8_t high)
{
    uint8_t pressed[8], any = 0;
    for (int r = 0; r < 8; r++) {
        pressed[r] = (uint8_t)(~zx.keys[r] & 0x1F);
        any |= pressed[r];
    }
    if (!any)
        return 0x1F;
    uint8_t rows = (uint8_t)~high, cols = 0, prev;
    do {
        prev = cols;
        for (int r = 0; r < 8; r++)
            if (rows >> r & 1)
                cols |= pressed[r];
        for (int r = 0; r < 8; r++)
            if (pressed[r] & cols)
                rows |= (uint8_t)(1u << r);
    } while (cols != prev);
    return (uint8_t)(~cols & 0x1F);
}

static uint8_t read_fe(uint16_t port)
{
    uint8_t v = read_keyboard((uint8_t)(port >> 8));
    /* Bit 6: la cinta si está sonando; si no, Issue 3 sigue a EAR (bit 4) e Issue 2
     * necesita MIC y EAR a 0 para leer 0 (Fuse ula_write: ula_default_value). */
    int tape = tape_ear_bit(zx.t);
    uint8_t ear = tape >= 0 ? (uint8_t)(tape & 1)
                : zx.issue == 2 ? (zx.last_fe & 0x18) != 0 : (zx.last_fe >> 4) & 1;
    return (uint8_t)(v | 0xA0 | ear << 6);
}

/* Bus flotante (docs §8). Fuse spectrum_unattached_port con line_times[24] = 14320 y
 * left_border 24 se reduce a: o = (t − 14336) mod 224 dentro de las 192 líneas,
 * o < 128; en cada grupo de 8 T la ULA tiene en el bus bitmap(o%8=2), atributo(3),
 * bitmap+1(4), atributo+1(5) y 0xFF en 0,1,6,7. El primer byte sale en t = 14338
 * (comentario de Fuse; Ramsoft decía 14347 con otra convención de t). t es el
 * instante de muestreo del IN (1 T antes de su final, ver cabecera). */
static uint8_t floating_bus(void)
{
    uint32_t t = zx.t;
    if (t < 14336)
        return 0xFF;
    uint32_t line = (t - 14336) / ZX_TSTATES_PER_LINE;
    uint32_t o = (t - 14336) % ZX_TSTATES_PER_LINE;
    if (line >= 192 || o >= 128)
        return 0xFF;
    uint32_t col = (o >> 3) << 1;
    uint32_t pix = 0x4000 | (line & 0xC0) << 5 | (line & 0x07) << 8 | (line & 0x38) << 2;
    uint32_t att = 0x5800 + (line >> 3) * 32;
    switch (o & 7) {
    case 2: return zx.mem[pix + col];
    case 3: return zx.mem[att + col];
    case 4: return zx.mem[pix + col + 1];
    case 5: return zx.mem[att + col + 1];
    default: return 0xFF;
    }
}

/* Ciclo de E/S de 4 T con los cuatro patrones de docs §5. Desglose de Fuse:
 *   early: [C si byte alto contendido] +1
 *   late:  par            → C +2
 *          impar, alto C  → C +1  C +1  C
 *          impar, alto N  → +2
 *   lectura (IN) y +1 final.
 * Total: N:1 C:3 / C:1 C:3 / N:4 / C:1 C:1 C:1 C:1. */
static inline void io_early(uint16_t port)
{
    if (is_contended(port))
        io_contend(port);
    zx.t += 1;
}

static inline void io_late(uint16_t port)
{
    if (!(port & 1)) {
        io_contend(port);
        zx.t += 2;
    } else if (is_contended(port)) {
        io_contend(port);
        zx.t += 1;
        io_contend(port);
        zx.t += 1;
        io_contend(port);
    } else {
        zx.t += 2;
    }
}

static inline uint8_t bus_in(uint16_t port)
{
    io_early(port);
#ifdef ZX_TEST_HOOKS
    uint32_t ev = buslog_len;      /* el PR se registra aquí; su valor, tras la lectura */
#endif
    LOG(ZX_EV_PR, port, 0);
    io_late(port);
    uint8_t v = (port & 1) ? floating_bus() : read_fe(port);
#ifdef ZX_TEST_HOOKS
    if (ev < buslog_len)
        buslog[ev].value = v;
#endif
    zx.t += 1;
    return v;
}

static inline void bus_out(uint16_t port, uint8_t v)
{
    io_early(port);
    LOG(ZX_EV_PW, port, v);
    if (!(port & 1)) {
        /* La ULA cambia borde y beeper en este instante (Fuse writeport/ula_write). */
        video_catch_up(zx.t);
        audio_out(zx.t, v);
        zx.last_fe = v;
    }
    io_late(port);
    zx.t += 1;
}

/* /INT dura 32 T desde el inicio del frame (docs §2; Fuse interrupt_length = 32). */
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

/* Fin de frame: la última instrucción puede haber pasado de 69888; el exceso se
 * conserva como T inicial del frame siguiente (docs §1, Fuse spectrum_frame). */
static void end_frame(void)
{
    video_end_frame();
    audio_end_frame(ZX_TSTATES_PER_FRAME);
    tape_end_frame(ZX_TSTATES_PER_FRAME);
    zx.t -= ZX_TSTATES_PER_FRAME;
    zx.frame++;
}

/* Orden: breakpoint → (INT pendiente) → trampa de cinta → z80_step. */
static inline int run_one(int check_bp)
{
    uint16_t pc = zx.cpu.pc.w;
    if (check_bp) {
        if (!bp_skip && debug_is_bp(pc)) {
            bp_skip = 1;
            return ZX_STOP_BREAKPOINT;
        }
        bp_skip = 0;
    }
    /* Trampa de cinta (tape.c): en LD-BYTES y en LD-BREAK, el RET NZ al que llegan
     * también los cargadores que entran por 0x0562 (Fuse atrapa ahí). Sólo si la CPU
     * va a ejecutar de verdad la instrucción de PC: con una INT pendiente (misma
     * condición que z80_step) el hardware ejecuta antes la ISR, que vuelve aquí; y no
     * a mitad de instrucción (ei_delay = 0xDD/0xFD: prefijo pendiente, ver z80.c). */
    if ((pc == TAPE_LD_BYTES || pc == TAPE_LD_BREAK) && zx.cpu.ei_delay <= 1 &&
        !(zx.cpu.iff1 && !zx.cpu.ei_delay && bus_int_line()) && tape_trap())
        return ZX_STOP_FRAME;
    z80_step(&zx.cpu);
    /* En HALT el PC no avanza: un breakpoint en el HALT pararía en cada M1 de 4 T.
     * Mientras dure, no se mira (se para al llegar, no mientras espera la INT). */
    if (check_bp)
        bp_skip = zx.cpu.halted;
    return ZX_STOP_FRAME;
}

int zx_run_frame(void)
{
    if (!debug_bp_count) {
        /* Sin breakpoints (lo normal) el bucle no los mira: JS no puede poner uno a
         * mitad de frame. */
        while (zx.t < ZX_TSTATES_PER_FRAME)
            run_one(0);
        bp_skip = zx.cpu.halted;
    } else {
        while (zx.t < ZX_TSTATES_PER_FRAME) {
            int stop = run_one(1);
            if (stop)
                return stop;
        }
    }
    end_frame();
    return ZX_STOP_FRAME;
}

int zx_step(void)
{
    bp_skip = 1;
    run_one(1);
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
    build_contention();
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
    /* Un prefijo DD/FD pendiente (z80.c) no se aplica a la instrucción del PC nuevo. */
    if (zx.cpu.ei_delay > 1)
        zx.cpu.ei_delay = 0;
    bp_skip = 0;
}

/* ---- Hooks de test ---- */
#ifdef ZX_TEST_HOOKS

/* Más allá de la tabla no hay forma de que la máquina llegue sola; se limita para que
 * un test no pueda leer fuera de ella. */
void zx_t_set_tstate(uint32_t t)
{
    zx.t = t < CONTENTION_SIZE - 64 ? t : CONTENTION_SIZE - 64;
}

uint32_t zx_t_contention(uint32_t t)      { return t < CONTENTION_SIZE ? contention[t] : 0; }
void     zx_t_set_int_enabled(uint32_t on) { zx.int_enabled = on != 0; }

/* Ejecuta instrucciones (sin breakpoints ni trampa de cinta) hasta zx.t >= t. Como el
 * esqueleto, no cierra el frame al llegar: zx.t puede quedar >= 69888 y el siguiente
 * zx_run_frame lo cierra. Sólo si hay que seguir más allá del fin de frame (t > 69888)
 * se cierra el frame y t pasa a contarse desde el siguiente; así la tabla de
 * contención nunca se indexa fuera de rango. */
int zx_t_run_until(uint32_t t)
{
    while (zx.t < t) {
        if (zx.t >= ZX_TSTATES_PER_FRAME) {
            end_frame();
            t -= ZX_TSTATES_PER_FRAME;
            continue;
        }
        z80_step(&zx.cpu);
    }
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
