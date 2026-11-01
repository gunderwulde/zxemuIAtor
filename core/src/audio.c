/*
 * audio.c — beeper: registro de cambios de EAR/MIC y conversión a muestras (M2).
 *
 * Modelo (docs/zx48-hardware.md §12):
 *  1. audio_out() registra (t, código) sólo cuando cambian los bits EAR (4) o MIC (3)
 *     del puerto 0xFE. Código = EAR<<1 | MIC, tal cual se escriben los bits.
 *  2. audio_end_frame(len) cierra el frame [0, len). Los OUT con t >= len (la última
 *     instrucción del frame lo cruza; zx48.c resta len a zx.t justo después) pasan al
 *     frame siguiente con t - len. Así ningún T-state se cuenta dos veces ni se pierde.
 *  3. zx_audio_render(rate) integra el nivel sobre cada periodo de muestra (filtro caja:
 *     área exacta bajo la señal, en enteros), aplica bloqueo de DC (paso alto de 1 polo)
 *     y un paso bajo de 1 polo que imita el altavoz. Todo el estado (fase de muestreo,
 *     área parcial, filtros) se arrastra entre frames: no hay saltos en la frontera.
 *
 * Unidades de la integración: "T×rate". Un T-state dura 'rate' unidades y una muestra
 * ZX_CPU_HZ unidades, así que las fronteras de muestra caen en enteros exactos y el
 * nº de muestras a lo largo de N frames es floor(N·len·rate / ZX_CPU_HZ) sin deriva.
 */
#include "machine.h"

/* ---- Niveles de EAR/MIC ----
 * Fuente: Fuse 1.6.0. peripherals/ula.c (ula_write) llama a
 *   sound_beeper(t, (!!(b & 0x10) << 1) + (!(b & 0x8) | tape_microphone))
 * y sound.c (sound_beeper) usa beeper_ampl[] = { 0, AMPL_TAPE, AMPL_BEEPER,
 * AMPL_BEEPER + AMPL_TAPE } con AMPL_BEEPER = 50·256 y AMPL_TAPE = 2·256; sin cinta
 * sonando fuerza on == 1 a 0 ("MIC solo no supera el umbral de 1,4 V", ULA book).
 * Ojo: en Fuse MIC suma cuando el bit 3 vale 0. Traducido a nuestro código EAR<<1|MIC:
 *   EAR=0 MIC=0 → 0    EAR=0 MIC=1 → 0    EAR=1 MIC=0 → 52    EAR=1 MIC=1 → 50
 * Escala entera: se normaliza por LEVEL_MAX al emitir la muestra. */
#define LEVEL_MAX 52u
static const uint32_t level_of[4] = { 0, 0, 52, 50 };

/* ---- Filtros (se recalculan cuando cambia rate) ----
 * Bloqueo de DC: y[n] = a·(y[n-1] + x[n] - x[n-1]), a = e^(-2π·HP_HZ/rate).
 * Altavoz:       z[n] = z[n-1] + b·(y[n] - z[n-1]), b = 1 - e^(-2π·LP_HZ/rate).
 * Con x en [0,1] el paso alto da y en [-1,1] y el paso bajo es una media convexa, así
 * que la salida nunca satura. */
#define HP_HZ 25.0
#define LP_HZ 7000.0

/* ---- Log de transiciones ----
 * Un OUT a 0xFE cuesta como mínimo 11 T (OUT (n),A), así que en un frame de
 * 69888 T (+ el exceso de la última instrucción) caben a lo sumo ~6355 cambios: 8192
 * no se desborda nunca con la CPU real. Si aun así se llenase (p. ej. moviendo zx.t
 * hacia atrás con hooks de test), el último cambio sobrescribe el código de la última
 * entrada: el nivel al final del frame sigue siendo correcto y el error queda
 * confinado al tramo final. */
#define LOG_MAX 8192

static uint32_t cur_log[2 * LOG_MAX];   /* frame abierto: pares (t, código) */
static uint32_t cur_n;
static uint32_t cur_start;              /* código al empezar el frame abierto */
static uint32_t last_code;              /* código tras el último OUT */

static uint32_t done_log[2 * LOG_MAX];  /* último frame cerrado, pendiente de render */
static uint32_t done_n;
static uint32_t done_start;
static uint32_t done_len;
static uint32_t done_ready;

/* ---- Estado del resampler (persistente entre frames) ---- */
static float    samples[ZX_AUDIO_MAX_SAMPLES];
static uint32_t cur_rate;   /* rate de la última llamada; 0 = ninguna aún */
static uint32_t pos;        /* unidades ya acumuladas en la muestra en curso, < ZX_CPU_HZ */
static uint32_t area;       /* área (nivel × unidades) de la muestra en curso; ≤ 52·3,5e6 */
static float    hp_a, lp_b;
static float    hp_x1, hp_y1, lp_z1;

/* e^(-x) para x >= 0 sin libc: reducción x/2^k < 1/64, Taylor de grado 5 y k
 * cuadrados. Error relativo ~1e-12, sobra para coeficientes de filtro. */
static double exp_neg(double x)
{
    int k = 0;
    while (x > 1.0 / 64.0) {
        x *= 0.5;
        k++;
    }
    double y = 1.0 - x * (1.0 - x * (0.5 - x * (1.0 / 6.0 - x * (1.0 / 24.0 - x / 120.0))));
    while (k--)
        y *= y;
    return y;
}

#define TWO_PI 6.283185307179586

static void set_rate(uint32_t rate)
{
    cur_rate = rate;
    hp_a = (float)exp_neg(TWO_PI * HP_HZ / rate);
    lp_b = (float)(1.0 - exp_neg(TWO_PI * LP_HZ / rate));
    /* La fase de muestreo no tiene sentido con otra rate: se descarta la muestra
     * parcial (los filtros se conservan para no producir un escalón). */
    pos = 0;
    area = 0;
}

void audio_reset(void)
{
    cur_n = 0;
    cur_start = 0;
    last_code = 0;
    done_n = 0;
    done_start = 0;
    done_len = 0;
    done_ready = 0;
    cur_rate = 0;
    pos = 0;
    area = 0;
    hp_x1 = hp_y1 = lp_z1 = 0.0f;
}

void audio_out(uint32_t t, uint8_t fe)
{
    uint32_t code = (uint32_t)(fe >> 3) & 3;
    if (code == last_code)
        return;
    last_code = code;
    if (cur_n) {
        uint32_t *last = &cur_log[2 * (cur_n - 1)];
        if (t < last[0])
            t = last[0];   /* sólo con hooks que mueven zx.t hacia atrás */
        if (t == last[0] || cur_n == LOG_MAX) {
            last[1] = code;
            return;
        }
    }
    cur_log[2 * cur_n] = t;
    cur_log[2 * cur_n + 1] = code;
    cur_n++;
}

void audio_end_frame(uint32_t frame_len)
{
    /* Si el frame anterior no se llegó a renderizar se pierde su audio (p. ej. al
     * avanzar con zx_step por varios frames): sólo se conserva el último. */
    uint32_t i = 0;
    done_start = cur_start;
    while (i < cur_n && cur_log[2 * i] < frame_len) {
        done_log[2 * i] = cur_log[2 * i];
        done_log[2 * i + 1] = cur_log[2 * i + 1];
        i++;
    }
    done_n = i;
    done_len = frame_len;
    done_ready = 1;
    cur_start = i ? done_log[2 * i - 1] : done_start;

    uint32_t j = 0;
    for (; i < cur_n; i++, j++) {
        cur_log[2 * j] = cur_log[2 * i] - frame_len;
        cur_log[2 * j + 1] = cur_log[2 * i + 1];
    }
    cur_n = j;
}

/* Emite la muestra acumulada en 'area': caja → bloqueo de DC → altavoz. */
static inline void emit(uint32_t *n)
{
    float x = (float)((double)area * (1.0 / ((double)LEVEL_MAX * ZX_CPU_HZ)));
    float y = hp_a * (hp_y1 + x - hp_x1);
    float z = lp_z1 + lp_b * (y - lp_z1);
    /* Sin denormales cuando la señal decae en silencio. */
    if (y > -1e-20f && y < 1e-20f) y = 0.0f;
    if (z > -1e-20f && z < 1e-20f) z = 0.0f;
    hp_x1 = x;
    hp_y1 = y;
    lp_z1 = z;
    if (*n < ZX_AUDIO_MAX_SAMPLES)
        samples[*n] = z;
    (*n)++;
    area = 0;
    pos = 0;
}

/* Integra un tramo de 'dt' T-states a nivel constante 'level'. */
static void segment(uint32_t dt, uint32_t level, uint32_t *n)
{
    uint64_t units = (uint64_t)dt * cur_rate;
    while (units) {
        uint32_t room = ZX_CPU_HZ - pos;
        uint32_t take = units < room ? (uint32_t)units : room;
        area += level * take;
        pos += take;
        units -= take;
        if (pos == ZX_CPU_HZ)
            emit(n);
    }
}

uint32_t zx_audio_render(uint32_t rate)
{
    if (!done_ready || rate == 0)
        return 0;
    done_ready = 0;
    if (rate != cur_rate)
        set_rate(rate);

    uint32_t n = 0, t0 = 0, code = done_start;
    for (uint32_t i = 0; i < done_n; i++) {
        uint32_t t = done_log[2 * i];
        ZX_ASSERT(t >= t0 && t < done_len);
        segment(t - t0, level_of[code], &n);
        t0 = t;
        code = done_log[2 * i + 1];
    }
    segment(done_len - t0, level_of[code], &n);
    /* Más de ZX_AUDIO_MAX_SAMPLES sólo con rate > ~205 kHz: el exceso se descarta
     * (el estado avanza igual, así que el siguiente frame sigue siendo continuo). */
    return n < ZX_AUDIO_MAX_SAMPLES ? n : ZX_AUDIO_MAX_SAMPLES;
}

float *zx_audio_buffer(void) { return samples; }

#ifdef ZX_TEST_HOOKS
/* Transiciones del frame abierto (el que se está ejecutando): pares (t, código
 * EAR<<1|MIC). Tras zx_run_frame contiene sólo los OUT que cruzaron el límite. */
uint32_t *zx_t_beeper_log(void)     { return cur_log; }
uint32_t  zx_t_beeper_log_len(void) { return cur_n; }
#endif
