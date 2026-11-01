/*
 * tape.c — cinta TAP: carga rápida por trampa en LD-BYTES y reproducción por pulsos
 * (docs/zx48-hardware.md §10).
 *
 * Fuentes:
 *  - Trampa: estructura de Fuse, tape_traps.c (tape_load_trap): Fuse atrapa el RET NZ
 *    de LD-BREAK (0x056B), con el preámbulo de LD-BYTES ya ejecutado, y vuelve por el
 *    RET de 0x05E2. Aquí zx48.c llama en 0x0556 (machine.h), y entonces se ejecuta el
 *    preámbulo a mano hasta el estado de 0x056B, y también en 0x056B, que es por donde
 *    pasan los cargadores que entran en 0x0562 con su propio preámbulo. En ambos casos
 *    zx48.c no llama si hay una INT pendiente (la CPU la acepta antes). El estado de
 *    salida NO es el de Fuse sino el de la ROM (ver load_block).
 *  - Pulsos: timings de la ROM (los mismos que Fuse reconoce como "ROM pilot" en
 *    pzx_has_rom_pilot): guía 2168 T × 8063 (cabecera, flag < 0x80) o × 3223 (datos),
 *    sincronismo 667 + 735 T, bit 0 = 2 × 855 T, bit 1 = 2 × 1710 T; pausa de 1000 ms
 *    tras cada bloque TAP (libspectrum usa 1000 ms para bloques TAP).
 *
 * La trampa no consume T-states ni toca R (Fuse: "no point in altering it").
 */
#include "machine.h"

/* ---- ROM 48K ---- */
#define ROM_LD_RET_PC  0x05E2   /* RET final de LD-BYTES: todas las salidas pasan por él */
#define ROM_SA_LD_RET  0x053F   /* dirección que LD-BYTES apila en 0x055E */
#define ROM_LOAD_LO    0x0562   /* zona de lectura de EAR de LD-BYTES / LD-EDGE */
#define ROM_LOAD_HI    0x0605

/* ---- Flags Z80 ---- */
#define FC 0x01
#define FN 0x02
#define FP 0x04
#define F3 0x08
#define FH 0x10
#define F5 0x20
#define FZ 0x40
#define FS 0x80

/* ---- Timings de la ROM (T-states) ---- */
#define T_PILOT      2168
#define N_PILOT_HDR  8063
#define N_PILOT_DATA 3223
#define T_SYNC1      667
#define T_SYNC2      735
#define T_BIT0       855
#define T_BIT1       1710
#define T_PAUSE      3500000u   /* 1000 ms a 3,5 MHz */

/* Arranque automático por cargador propio (docs §10). No hay fuente de hardware: en
 * la máquina real la cinta suena cuando el usuario pulsa PLAY. Esto adivina cuándo lo
 * habría hecho. Dos fases:
 *  1. Sospecha: AUTO_FRAMES frames seguidos con al menos AUTO_READS lecturas de un
 *     puerto par con DI, cada una a <= AUTO_LOOP_T de la anterior (bucle cerrado de
 *     muestreo: la ROM muestrea cada 59 T en LD-SAMPLE). La cinta arranca a prueba.
 *  2. Prueba: un cargador detecta flancos y, al ver uno, sale del bucle de muestreo
 *     (LD-EDGE vuelve, el llamador mide y vuelve a entrar), así que la lectura que
 *     sigue a un cambio de nivel llega más tarde que el ritmo del bucle. Un menú o un
 *     motor de música que lee el teclado no reacciona: su ritmo no cambia. De los
 *     primeros AUTO_CHECKS cambios vistos, al menos la mitad deben ir seguidos de una
 *     lectura retrasada más de AUTO_REACT_T; si no, o si la guía se acaba antes, la
 *     cinta se para y se rebobina al inicio del bloque. */
#define AUTO_LOOP_T   200
#define AUTO_READS    256
#define AUTO_FRAMES   2
#define AUTO_CHECKS   16
#define AUTO_REACT_T  20

static uint8_t  tap[ZX_IO_BUFFER_SIZE];   /* copia propia: zx_io se reutiliza */
static uint32_t tap_len;                  /* 0 = no hay cinta */
static uint32_t cur;                      /* offset del bloque actual (campo longitud) */

enum { PH_FRESH, PH_PILOT, PH_SYNC1, PH_SYNC2, PH_DATA, PH_PAUSE, PH_END };

static uint8_t  phase;       /* segmento que se está emitiendo */
static uint8_t  playing;
static uint8_t  level;       /* nivel EAR actual (0/1) */
static uint8_t  half;        /* 0 = primer pulso del bit, 1 = segundo */
static uint8_t  mask;        /* bit en curso del byte (MSB primero) */
static uint32_t count;       /* pulsos de guía que faltan tras el actual */
static uint32_t pos;         /* byte en curso dentro del bloque */
static uint64_t frame_base;  /* T absoluto del inicio del frame actual */
static uint64_t next_edge;   /* T absoluto en que acaba el segmento (si playing) */
/* Heurística de arranque automático (ver AUTO_*). */
static uint32_t reads;       /* lecturas en bucle cerrado con DI en este frame */
static uint8_t  loop_frames; /* frames seguidos anteriores con >= AUTO_READS */
static uint8_t  auto_play;   /* la reproducción en curso la arrancó la heurística */
static uint8_t  probation;   /* ... y aún no se ha confirmado que sea un cargador */
static uint8_t  checks;      /* cambios de nivel vistos en la prueba */
static uint8_t  reacted;     /* de ellos, seguidos de una lectura retrasada */
static uint8_t  changed;     /* la lectura anterior vio un cambio de nivel */
static uint8_t  last_level;  /* nivel devuelto en la lectura anterior */
static uint32_t last_dt;     /* T entre las dos lecturas anteriores */
static uint64_t last_read;   /* T absoluto de la lectura anterior */

static inline uint32_t blk_len(uint32_t off) { return tap[off] | (uint32_t)tap[off + 1] << 8; }
static inline const uint8_t *blk_data(uint32_t off) { return tap + off + 2; }

/* ---- Utilidades de flags (semántica Z80 estándar, como las macros de Fuse) ---- */

static uint8_t sz53(uint8_t v) { return (uint8_t)((v & (FS | F5 | F3)) | (v ? 0 : FZ)); }

static uint8_t parity(uint8_t v)
{
    v ^= v >> 4;
    v ^= v >> 2;
    v ^= v >> 1;
    return (v & 1) ? 0 : FP;
}

/* CP n: flags 3 y 5 del operando (no del resultado). */
static uint8_t flags_cp(uint8_t a, uint8_t n)
{
    uint32_t r = (uint32_t)a - n;
    uint8_t f = FN | (n & (F3 | F5)) | ((uint8_t)r & FS);
    if (r & 0x100) f |= FC;
    if (!(uint8_t)r) f |= FZ;
    if ((a & 0x0F) < (n & 0x0F)) f |= FH;
    if (((a ^ n) & (a ^ r)) & 0x80) f |= FP;
    return f;
}

static uint8_t flags_inc(uint8_t f, uint8_t r)
{
    return (uint8_t)((f & FC) | sz53(r) | ((r & 0x0F) ? 0 : FH) | (r == 0x80 ? FP : 0));
}

static uint8_t flags_dec(uint8_t f, uint8_t r)
{
    return (uint8_t)((f & FC) | FN | sz53(r) | ((r & 0x0F) == 0x0F ? FH : 0) | (r == 0x7F ? FP : 0));
}

static void poke(uint16_t a, uint8_t v)
{
    if (a < 0x4000)
        return;
    if (a < 0x5B00)
        video_catch_up(zx.t);
    zx.mem[a] = v;
}

/* ---- Reproducción por pulsos ---- */

static uint32_t bit_len(void)
{
    return (blk_data(cur)[pos] & mask) ? T_BIT1 : T_BIT0;
}

/* Termina el segmento en curso con un flanco y empieza el siguiente; devuelve su
 * duración. Cada límite de pulso es un flanco: la ROM mide semiperiodos entre flancos,
 * así que el último pulso de datos también necesita el flanco que lo cierra (el que
 * abre la pausa). */
static uint32_t edge(void)
{
    level ^= 1;
    switch (phase) {
    case PH_FRESH:
        phase = PH_PILOT;
        count = (blk_data(cur)[0] < 0x80 ? N_PILOT_HDR : N_PILOT_DATA) - 1;
        return T_PILOT;
    case PH_PILOT:
        if (count) {
            count--;
            return T_PILOT;
        }
        phase = PH_SYNC1;
        return T_SYNC1;
    case PH_SYNC1:
        phase = PH_SYNC2;
        return T_SYNC2;
    case PH_SYNC2:
        phase = PH_DATA;
        pos = 0;
        mask = 0x80;
        half = 0;
        return bit_len();
    case PH_DATA:
        if (!half) {
            half = 1;
            return bit_len();
        }
        half = 0;
        mask >>= 1;
        if (!mask) {
            mask = 0x80;
            pos++;
        }
        if (pos < blk_len(cur))
            return bit_len();
        phase = PH_PAUSE;
        return T_PAUSE;
    default:
        return 0;
    }
}

/* Salta bloques de longitud 0 (no tienen señal) y detecta el fin de cinta. */
static void seek_block(void)
{
    while (cur < tap_len && blk_len(cur) == 0)
        cur += 2;
    phase = cur < tap_len ? PH_FRESH : PH_END;
}

/* La cinta sólo se para en límites de bloque (fin de pausa, trampa, inserción), así
 * que siempre arranca en PH_FRESH. */
static void start(uint64_t now, int heuristic)
{
    playing = 1;
    auto_play = probation = (uint8_t)heuristic;
    checks = reacted = changed = 0;
    next_edge = now + edge();
    last_level = level;
}

/* Para la cinta y la deja al principio del bloque en curso (que no se ha terminado).
 * El nivel vuelve a 0 para que la polaridad no dependa de los arranques fallidos. */
static void rewind_block(void)
{
    playing = 0;
    auto_play = probation = 0;
    phase = PH_FRESH;
    level = 0;
    loop_frames = 0;
    reads = 0;
}

/* Lleva la cinta hasta el T absoluto 'now'. Al acabar la pausa de un bloque la cinta
 * se para sola ante el siguiente: si el programa vuelve a llamar a LD-BYTES lo carga
 * la trampa; si no, el arranque automático la pone en marcha otra vez. */
static void advance(uint64_t now)
{
    while (playing && next_edge <= now) {
        if (phase == PH_PAUSE) {
            cur += 2 + blk_len(cur);
            seek_block();
            playing = 0;
            auto_play = probation = 0;
            return;
        }
        next_edge += edge();
    }
}

void tape_reset(void)
{
    cur = 0;
    playing = 0;
    level = 0;
    reads = 0;
    loop_frames = 0;
    auto_play = probation = 0;
    last_read = 0;
    last_dt = 0;
    frame_base = 0;
    seek_block();
}

int tape_ear_bit(uint32_t t)
{
    uint64_t now = frame_base + t;
    uint64_t gap = now - last_read;
    uint32_t dt = gap > 0xFFFFFFFFu ? 0xFFFFFFFFu : (uint32_t)gap;
    uint32_t prev_dt = last_dt;
    last_read = now;
    last_dt = dt;
    if (!playing) {
        if (phase == PH_END)
            return -1;
        /* Arranque automático: la ROM está muestreando EAR dentro de LD-BYTES/LD-EDGE
         * (entrada que la trampa no ha visto), o un cargador propio parece leer EAR en
         * bucle con las interrupciones desactivadas (ver AUTO_*). */
        uint16_t pc = zx.cpu.pc.w;
        if (pc >= ROM_LOAD_LO && pc <= ROM_LOAD_HI)
            start(now, 0);
        else if (!zx.cpu.iff1 && dt <= AUTO_LOOP_T && ++reads >= AUTO_READS &&
                 loop_frames + 1 >= AUTO_FRAMES)
            start(now, 1);
        if (!playing)
            return -1;
        return level;
    }
    advance(now);
    if (!playing)
        return -1;
    if (probation) {
        if (phase != PH_PILOT) {
            rewind_block();            /* la guía se acabó sin confirmar: no era un cargador */
            return -1;
        }
        if (changed) {
            if (dt > prev_dt + AUTO_REACT_T)
                reacted++;
            if (++checks >= AUTO_CHECKS) {
                if (2u * reacted >= checks) {
                    probation = 0;
                } else {
                    rewind_block();
                    return -1;
                }
            }
        }
        changed = level != last_level;
        last_level = level;
    }
    return level;
}

void tape_end_frame(uint32_t frame_len)
{
    frame_base += frame_len;
    if (reads >= AUTO_READS) {
        if (loop_frames < 255)
            loop_frames++;
    } else {
        loop_frames = 0;
    }
    reads = 0;
}

/* ---- Trampa LD-BYTES ---- */

/* Carga el bloque actual partiendo del estado de 0x056B (tras el preámbulo).
 *
 * Es un modelo directo del bucle de la ROM 0x05A3-0x05E2, sin el muestreo de flancos:
 *
 *   05A3 LD H,0 ; LD B,B0 ; JR LD-MARKER
 *   05A9 LD-LOOP:   EX AF,AF' ; JR NZ,LD-FLAG ; JR NC,LD-VERIFY ; LD (IX+0),L ; JR LD-NEXT
 *   05B3 LD-FLAG:   RL C ; XOR L ; RET NZ ; LD A,C ; RRA ; LD C,A ; INC DE ; JR LD-DEC
 *   05BE LD-VERIFY: LD A,(IX+0) ; XOR L ; RET NZ
 *   05C2 LD-NEXT:   INC IX
 *   05C4 LD-DEC:    DEC DE ; EX AF,AF' ; LD B,B2
 *   05C8 LD-MARKER: LD L,1 ; LD-8-BITS (B = B0 al acabar cada bit) … RET NC si no hay flanco
 *   05D8 LD A,H ; XOR L ; LD H,A ; LD A,D ; OR E ; JR NZ,LD-LOOP
 *   05DF LD A,H ; CP 1 ; RET
 *
 * El estado de salida se ha contrastado registro a registro con la propia ROM leyendo
 * los pulsos de tape.c (tests/core/tape/trap.test.ts, "ROM real"). Difiere de lo que
 * documenta Fuse (tape_trap_load_block) en C, L tras la paridad, B en los fallos y AF'.
 *
 * C: LD-EDGE complementa C en cada flanco y su bit 5 sigue al nivel EAR; LD-SYNC hace
 * XOR 3. Con el reproductor de tape.c el nivel al empezar los datos es siempre 0
 * (guías de longitud impar), así que tras el sincronismo C = 0xDE. Con una cinta real
 * podría ser 0x21: la polaridad no está en el TAP. */
#define C_AFTER_SYNC 0xDE

static void load_block(void)
{
    ZxRegs *r = &zx.cpu;
    const uint8_t *p = blk_data(cur);
    uint32_t left = blk_len(cur);          /* bytes que quedan en la cinta (>= 1) */
    uint16_t de = r->de.w, ix = r->ix.w;
    uint8_t c = C_AFTER_SYNC, h = 0, l;
    /* AF del bucle: lo que el preámbulo dejó en AF' (A = flag pedido, F: Z de INC D,
     * C = cargar/verificar). AF principal: A = D|E con los flags de OR. */
    uint8_t la = r->af_.b.h, lf = r->af_.b.l;
    uint8_t ma, mf;

    l = *p++;                              /* flag (o primer byte si Z ya estaba a 1) */
    left--;
    h ^= l;
    for (;;) {
        ma = (uint8_t)(de >> 8 | de);
        mf = (uint8_t)(sz53(ma) | parity(ma));
        if (!de) {
            /* 05DF: A = paridad; CP 1 deja carry sólo si es 0. */
            r->af.b.h = h;
            r->af.b.l = flags_cp(h, 1);
            r->af_.b.h = la;
            r->af_.b.l = lf;
            r->bc.b.h = 0xB0;
            break;
        }
        /* LD-LOOP: AF' ↔ AF; el principal (D|E) queda en AF'. */
        if (!(lf & FZ)) {
            uint8_t rl = (uint8_t)(c << 1 | (lf & FC));
            la ^= l;
            lf = (uint8_t)(sz53(la) | parity(la));
            if (la) {
                c = rl;
                goto exit_nz;
            }
            la = rl >> 1;                  /* RRA con carry 0 (lo borró XOR) */
            lf = (uint8_t)((lf & (FS | FZ | FP)) | (la & (F3 | F5)) | (rl & FC));
            c = la;
            de++;
        } else if (!(lf & FC)) {
            la = (uint8_t)(zx.mem[ix] ^ l);
            lf = (uint8_t)(sz53(la) | parity(la));
            if (la)
                goto exit_nz;
            ix++;
        } else {
            poke(ix, l);
            ix++;
        }
        de--;                              /* LD-DEC; EX AF,AF' devuelve el principal */
        if (!left) {
            /* No hay más bytes: el primer bit no llega (0x05ED INC B con B = FF → 0,
             * RET Z con el carry que borró el AND A de 0x05EC). */
            r->af.w = 0x0050;
            r->af_.b.h = la;
            r->af_.b.l = lf;
            r->bc.b.h = 0;
            r->hl.b.l = 1;
            goto done;
        }
        l = *p++;
        left--;
        h ^= l;
    }
    r->hl.b.l = l;
    goto done;
exit_nz:
    /* RET NZ desde LD-FLAG o LD-VERIFY: AF = bucle, AF' = principal. */
    r->af.b.h = la;
    r->af.b.l = lf;
    r->af_.b.h = ma;
    r->af_.b.l = mf;
    r->bc.b.h = 0xB0;
    r->hl.b.l = l;
done:
    r->bc.b.l = c;
    r->hl.b.h = h;
    r->de.w = de;
    r->ix.w = ix;
}

/* Preámbulo de LD-BYTES 0x0556-0x056A, hasta el estado que ve Fuse en 0x056B:
 *   INC D; EX AF,AF'; DEC D; DI; LD A,0x0F; OUT (0xFE),A; LD HL,0x053F; PUSH HL;
 *   IN A,(0xFE); RRA; AND 0x20; OR 0x02; LD C,A; CP A */
static void rom_prologue(void)
{
    ZxRegs *r = &zx.cpu;
    uint8_t d = (uint8_t)(r->de.b.h + 1);
    r->af.b.l = flags_inc(r->af.b.l, d);
    ZxPair t = r->af;
    r->af = r->af_;
    r->af_ = t;
    d--;
    r->de.b.h = d;
    r->af.b.l = flags_dec(r->af.b.l, d);
    r->iff1 = r->iff2 = 0;
    video_catch_up(zx.t);
    audio_out(zx.t, 0x0F);
    zx.last_fe = 0x0F;
    r->sp.w -= 2;
    poke(r->sp.w, ROM_SA_LD_RET & 0xFF);
    poke((uint16_t)(r->sp.w + 1), ROM_SA_LD_RET >> 8);
    /* IN A,(0xFE) con la cinta parada: el bit 6 es el de Issue 2/3 (docs §6) con el
     * 0x0F recién escrito. RRA lo pasa al bit 5, que es lo único que sobrevive. */
    uint8_t ear = zx.issue == 2 ? 1 : 0;
    uint8_t a = (uint8_t)(ear << 5 | 0x02);
    r->hl.w = ROM_SA_LD_RET;
    r->bc.b.l = a;
    r->af.b.h = a;
    r->af.b.l = flags_cp(a, a);
}

int tape_trap(void)
{
    ZxRegs *r = &zx.cpu;
    uint16_t pc = r->pc.w;

    if (pc != TAPE_LD_BYTES && pc != TAPE_LD_BREAK)
        return 0;
    /* En 0x056B con Z = 0 la ROM está saliendo por BREAK: que lo haga. */
    if (pc == TAPE_LD_BREAK && !(r->af.b.l & FZ))
        return 0;
    if (!tap_len)
        return 0;
    /* Sólo en un límite de bloque: parada antes de un bloque, en su tono guía o en la
     * pausa que sigue al anterior. A mitad de sincronismo o datos la ROM debe leer los
     * pulsos de verdad. */
    if (playing)
        advance(frame_base + zx.t);
    /* Si la heurística arrancó la cinta y el bloque va a medias, el programa ha dejado
     * de leerla: o era un falso positivo o un cargador propio que se ha rendido. En
     * ambos casos lo que pide LD-BYTES es ese bloque entero: se rebobina. */
    if (playing && auto_play && phase != PH_PAUSE)
        rewind_block();
    if (phase == PH_PAUSE) {
        cur += 2 + blk_len(cur);
        seek_block();
        playing = 0;
    }
    if (phase != PH_FRESH && phase != PH_PILOT)
        return 0;   /* incluye fin de cinta: la ROM espera señal hasta BREAK, como sin cinta */

    if (pc == TAPE_LD_BYTES)
        rom_prologue();
    load_block();
    r->pc.w = ROM_LD_RET_PC;
    r->halted = 0;
    r->ei_delay = 0;
    r->ld_air = 0;

    playing = 0;
    cur += 2 + blk_len(cur);
    seek_block();
    return 1;
}

/* ---- ABI ---- */

int zx_load_tap(uint32_t len)
{
    if (len == 0 || len > ZX_IO_BUFFER_SIZE)
        return ZX_ERR_SIZE;
    for (uint32_t off = 0; off < len;) {
        if (len - off < 2)
            return ZX_ERR_FORMAT;
        uint32_t n = zx_io[off] | (uint32_t)zx_io[off + 1] << 8;
        if (n > len - off - 2)
            return ZX_ERR_FORMAT;
        off += 2 + n;
    }
    zx_memcpy(tap, zx_io, len);
    tap_len = len;
    cur = 0;
    playing = 0;
    reads = 0;
    loop_frames = 0;
    auto_play = probation = 0;
    seek_block();
    return ZX_OK;
}
