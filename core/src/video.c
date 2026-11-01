/*
 * video.c — ULA: pantalla y borde a framebuffer RGBA 352×296.
 *
 * STUB DE FASE 0: dibuja el frame completo de golpe al final con el estado final de
 * memoria y borde (sin render perezoso al T-state). Lo sustituye M1 (PLAN.md).
 */
#include "machine.h"

static uint32_t fb[ZX_FB_WIDTH * ZX_FB_HEIGHT];
static uint32_t flash_frames;

/* RGBA en memoria = 0xAABBGGRR en uint32 little-endian. Índice GRB (docs §3). */
#define RGB(r, g, b) (0xFF000000u | (uint32_t)(b) << 16 | (uint32_t)(g) << 8 | (uint32_t)(r))
static const uint32_t palette[16] = {
    RGB(0x00, 0x00, 0x00), RGB(0x00, 0x00, 0xD7), RGB(0xD7, 0x00, 0x00), RGB(0xD7, 0x00, 0xD7),
    RGB(0x00, 0xD7, 0x00), RGB(0x00, 0xD7, 0xD7), RGB(0xD7, 0xD7, 0x00), RGB(0xD7, 0xD7, 0xD7),
    RGB(0x00, 0x00, 0x00), RGB(0x00, 0x00, 0xFF), RGB(0xFF, 0x00, 0x00), RGB(0xFF, 0x00, 0xFF),
    RGB(0x00, 0xFF, 0x00), RGB(0x00, 0xFF, 0xFF), RGB(0xFF, 0xFF, 0x00), RGB(0xFF, 0xFF, 0xFF),
};

void video_reset(void)
{
    flash_frames = 0;
    zx_memset(fb, 0, sizeof fb);
}

void video_catch_up(uint32_t t)
{
    (void)t;
}

void video_end_frame(void)
{
    uint32_t border = palette[zx.last_fe & 7];
    for (int i = 0; i < ZX_FB_WIDTH * ZX_FB_HEIGHT; i++)
        fb[i] = border;

    int flash = (flash_frames >> 4) & 1;
    for (int y = 0; y < 192; y++) {
        uint32_t *row = fb + (48 + y) * ZX_FB_WIDTH + 48;
        uint16_t pix = (uint16_t)(0x4000 | (y & 0xC0) << 5 | (y & 0x07) << 8 | (y & 0x38) << 2);
        uint16_t att = (uint16_t)(0x5800 + (y >> 3) * 32);
        for (int x = 0; x < 32; x++) {
            uint8_t p = zx.mem[pix + x], a = zx.mem[att + x];
            if ((a & 0x80) && flash)
                p = (uint8_t)~p;
            uint32_t ink = palette[(a & 7) | (a >> 3 & 8)];
            uint32_t paper = palette[(a >> 3 & 7) | (a >> 3 & 8)];
            for (int b = 0; b < 8; b++)
                row[x * 8 + b] = (p << b & 0x80) ? ink : paper;
        }
    }
    flash_frames++;
}

uint8_t *video_framebuffer(void) { return (uint8_t *)fb; }
