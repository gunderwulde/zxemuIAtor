/*
 * audio.c — beeper: registro de cambios de EAR/MIC y conversión a muestras.
 *
 * STUB DE FASE 0: genera silencio con el número correcto de muestras por frame
 * (arrastrando el resto fraccional). Lo sustituye M2 (PLAN.md).
 */
#include "machine.h"

static float    samples[ZX_AUDIO_MAX_SAMPLES];
static uint64_t frac;          /* resto en unidades de (T-states × rate) */
static uint32_t last_frame_len = ZX_TSTATES_PER_FRAME;

void audio_reset(void)
{
    frac = 0;
    last_frame_len = ZX_TSTATES_PER_FRAME;
}

void audio_out(uint32_t t, uint8_t fe)
{
    (void)t;
    (void)fe;
}

void audio_end_frame(uint32_t frame_len)
{
    last_frame_len = frame_len;
}

uint32_t zx_audio_render(uint32_t rate)
{
    frac += (uint64_t)last_frame_len * rate;
    uint32_t n = (uint32_t)(frac / ZX_CPU_HZ);
    frac -= (uint64_t)n * ZX_CPU_HZ;
    if (n > ZX_AUDIO_MAX_SAMPLES)
        n = ZX_AUDIO_MAX_SAMPLES;
    zx_memset(samples, 0, n * sizeof samples[0]);
    return n;
}

float *zx_audio_buffer(void) { return samples; }

#ifdef ZX_TEST_HOOKS
static uint32_t beeper_log[2];
uint32_t *zx_t_beeper_log(void)     { return beeper_log; }
uint32_t  zx_t_beeper_log_len(void) { return 0; }
#endif
