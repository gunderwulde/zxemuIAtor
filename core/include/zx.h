/*
 * zx.h — ABI pública del núcleo ZX Spectrum 48K (lo único que ve JavaScript).
 *
 * CONTRATO CONGELADO (fin de la fase 0). Sólo el coordinador lo modifica.
 *
 * Reglas del ABI:
 *  - Sólo enteros, floats y punteros a regiones estáticas. Nada se reserva en tiempo
 *    de ejecución: cada puntero devuelto es válido durante toda la vida del módulo.
 *  - Para pasar ficheros: JS escribe en zx_io_buffer() y llama a zx_load_*(len).
 *  - Direcciones y valores se pasan como uint32_t y se truncan dentro (JS no tiene u16).
 */
#ifndef ZX_H
#define ZX_H

#include <stddef.h>
#include <stdint.h>

#define ZX_EXPORT(name) __attribute__((export_name(#name)))

/* ---- Geometría y tiempos (docs/zx48-hardware.md §1, §7) ---- */
#define ZX_CPU_HZ            3500000
#define ZX_TSTATES_PER_LINE  224
#define ZX_LINES_PER_FRAME   312
#define ZX_TSTATES_PER_FRAME 69888
#define ZX_FB_WIDTH          352      /* 48 + 256 + 48 */
#define ZX_FB_HEIGHT         296      /* 48 + 192 + 56 */
#define ZX_ROM_SIZE          16384
#define ZX_IO_BUFFER_SIZE    (512 * 1024)
#define ZX_AUDIO_MAX_SAMPLES 4096     /* por frame; sobra para 192 kHz */

/* ---- Estado de la CPU ----
 * El núcleo trabaja DIRECTAMENTE sobre este struct (no hay copia), así que JS puede
 * leerlo y modificarlo entre frames. Little-endian (wasm): en un par, .b.l es el byte
 * bajo (F, C, E, L, IXL…) y .b.h el alto (A, B, D, H, IXH…).
 * Espejo TypeScript: web/src/emu/regs.ts (mismos offsets).
 */
typedef union {
    uint16_t w;
    struct { uint8_t l, h; } b;
} ZxPair;

typedef struct {
    ZxPair  af, bc, de, hl;       /*  0  2  4  6 */
    ZxPair  af_, bc_, de_, hl_;   /*  8 10 12 14  registros alternativos */
    ZxPair  ix, iy, sp, pc;       /* 16 18 20 22 */
    ZxPair  memptr;               /* 24  WZ, registro interno */
    uint8_t i, r;                 /* 26 27  r = valor arquitectónico completo (bit 7 incluido) */
    uint8_t iff1, iff2, im;       /* 28 29 30 */
    uint8_t halted;               /* 31  1 = ejecutando HALT */
    uint8_t q;                    /* 32  F si la última instrucción modificó flags, si no 0 */
    uint8_t ei_delay;             /* 33  ≠0 = no aceptar INT: 1 = la última fue EI; 0xDD/0xFD = prefijo pendiente */
    uint8_t ld_air;               /* 34  1 = la última instrucción fue LD A,I / LD A,R (bug NMOS de P/V) */
    uint8_t _pad;                 /* 35 */
} ZxRegs;                         /* 36 bytes */

_Static_assert(offsetof(ZxRegs, pc) == 22, "ZxRegs layout");
_Static_assert(offsetof(ZxRegs, memptr) == 24, "ZxRegs layout");
_Static_assert(offsetof(ZxRegs, i) == 26, "ZxRegs layout");
_Static_assert(offsetof(ZxRegs, halted) == 31, "ZxRegs layout");
_Static_assert(offsetof(ZxRegs, ld_air) == 34, "ZxRegs layout");
_Static_assert(sizeof(ZxRegs) == 36, "ZxRegs layout");

/* ---- Motivos de parada ---- */
enum {
    ZX_STOP_FRAME      = 0,   /* frame completo */
    ZX_STOP_BREAKPOINT = 1,   /* PC alcanzó un breakpoint (la instrucción NO se ha ejecutado) */
    ZX_STOP_STEP       = 2,   /* zx_step terminó */
};

/* ---- Errores de carga ---- */
enum {
    ZX_OK          = 0,
    ZX_ERR_SIZE    = -1,      /* longitud imposible para el formato */
    ZX_ERR_FORMAT  = -2,      /* contenido malformado */
    ZX_ERR_MODEL   = -3,      /* snapshot de un modelo distinto del 48K */
};

/* ---- Ciclo de vida ---- */
ZX_EXPORT(zx_init)        void     zx_init(void);                 /* estado a cero; luego zx_load_rom */
ZX_EXPORT(zx_load_rom)    int      zx_load_rom(uint32_t len);     /* desde io_buffer; len debe ser 16384 */
ZX_EXPORT(zx_reset)       void     zx_reset(void);                /* encendido: CPU a estado inicial, RAM a 0 (determinista), frame a T 0 */
ZX_EXPORT(zx_set_issue)   void     zx_set_issue(uint32_t issue);  /* 2 o 3 (por defecto 3) */

/* ---- Ejecución ---- */
ZX_EXPORT(zx_run_frame)   int      zx_run_frame(void);            /* hasta fin de frame o breakpoint */
ZX_EXPORT(zx_step)        int      zx_step(void);                 /* una instrucción (o aceptación de INT) */
ZX_EXPORT(zx_tstate)      uint32_t zx_tstate(void);               /* T-state dentro del frame actual */
ZX_EXPORT(zx_frame_count) uint32_t zx_frame_count(void);

/* ---- Regiones de memoria ---- */
ZX_EXPORT(zx_framebuffer)     uint8_t  *zx_framebuffer(void);     /* RGBA, ZX_FB_WIDTH*ZX_FB_HEIGHT*4 */
ZX_EXPORT(zx_ram)             uint8_t  *zx_ram(void);             /* 64 KB planos; 0x0000-0x3FFF = ROM */
ZX_EXPORT(zx_regs)            ZxRegs   *zx_regs(void);
ZX_EXPORT(zx_io_buffer)       uint8_t  *zx_io_buffer(void);
ZX_EXPORT(zx_io_buffer_size)  uint32_t  zx_io_buffer_size(void);

/* ---- Audio ---- */
/* Convierte el beeper del último frame a muestras float mono [-1,1] a 'rate' Hz.
 * Devuelve cuántas; quedan en zx_audio_buffer(). El resto fraccional se arrastra
 * entre frames (no se pierde ni duplica ninguna muestra). */
ZX_EXPORT(zx_audio_render) uint32_t zx_audio_render(uint32_t rate);
ZX_EXPORT(zx_audio_buffer) float   *zx_audio_buffer(void);

/* ---- Entrada ---- */
/* row 0..7 = semifilas 0xFEFE..0x7FFE (docs §6), bit 0..4. */
ZX_EXPORT(zx_key) void zx_key(uint32_t row, uint32_t bit, uint32_t down);

/* ---- Ficheros (leen/escriben zx_io_buffer) ---- */
ZX_EXPORT(zx_load_tap)  int      zx_load_tap(uint32_t len);   /* inserta la cinta (carga por trampa ROM) */
ZX_EXPORT(zx_load_sna)  int      zx_load_sna(uint32_t len);
ZX_EXPORT(zx_load_z80)  int      zx_load_z80(uint32_t len);
ZX_EXPORT(zx_save_sna)  uint32_t zx_save_sna(void);           /* devuelve longitud (49179) */

/* ---- Depuración ---- */
ZX_EXPORT(zx_bp_set)       void zx_bp_set(uint32_t addr, uint32_t on);
ZX_EXPORT(zx_bp_clear_all) void zx_bp_clear_all(void);
ZX_EXPORT(zx_poke)         void zx_poke(uint32_t addr, uint32_t value);  /* sólo RAM; ignora ROM */
ZX_EXPORT(zx_set_pc)       void zx_set_pc(uint32_t addr);                /* también sale de HALT */

/* ---- Eventos de bus (core-probe.wasm y core-test.wasm) ---- */
/* MC contención de memoria, MR/MW lectura/escritura, PR/PW E/S, PC contención de E/S */
enum { ZX_EV_MC = 0, ZX_EV_MR = 1, ZX_EV_MW = 2, ZX_EV_PR = 3, ZX_EV_PW = 4, ZX_EV_PC = 5 };

typedef struct {
    uint32_t t;        /* T-state en el que se registra (convención FUSE, ver bus.h) */
    uint16_t addr;
    uint8_t  kind;     /* ZX_EV_* */
    uint8_t  value;    /* 0 en MC */
} ZxBusEvent;          /* 8 bytes */

_Static_assert(sizeof(ZxBusEvent) == 8, "ZxBusEvent layout");

#define ZX_BUSLOG_MAX 65536

/* ---- Hooks de test (sólo core-probe.wasm, docs/TEST-PLAN.md §1) ---- */
#ifdef ZX_TEST_HOOKS

ZX_EXPORT(zx_t_set_tstate)      void        zx_t_set_tstate(uint32_t t);
ZX_EXPORT(zx_t_contention)      uint32_t    zx_t_contention(uint32_t t);
ZX_EXPORT(zx_t_run_until)       int         zx_t_run_until(uint32_t t);
ZX_EXPORT(zx_t_set_int_enabled) void        zx_t_set_int_enabled(uint32_t on);
ZX_EXPORT(zx_t_buslog_enable)   void        zx_t_buslog_enable(uint32_t on);  /* también vacía el log */
ZX_EXPORT(zx_t_buslog)          ZxBusEvent *zx_t_buslog(void);
ZX_EXPORT(zx_t_buslog_len)      uint32_t    zx_t_buslog_len(void);
ZX_EXPORT(zx_t_beeper_log)      uint32_t   *zx_t_beeper_log(void);   /* pares (t, nivel) */
ZX_EXPORT(zx_t_beeper_log_len)  uint32_t    zx_t_beeper_log_len(void); /* nº de pares */

#endif /* ZX_TEST_HOOKS */

#endif /* ZX_H */
