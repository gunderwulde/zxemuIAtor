/*
 * video.c — ULA: pantalla y borde a framebuffer RGBA 352×296, render perezoso al
 * T-state (M1, docs §7).
 *
 * Geometría: el framebuffer son 296 líneas × 44 "chunks" de 8 píxeles (4 T cada uno):
 * 6 chunks (48 px) de borde izquierdo, 32 de pantalla y 6 de borde derecho; 48 líneas
 * de borde superior, 192 de pantalla y 56 de borde inferior. La ULA emite el chunk
 * (línea fy, columna cx) en
 *     E(fy, cx) = 14336 + 224·(fy − 48) + 4·(cx − 6) = 3560 + 224·fy + 4·cx
 * (el byte 16384 en 14336, docs §7). Todo cabe dentro del frame: E va de 3560 a 69812.
 *
 * Regla de captura (Fuse display_dirty.c y display_border.c, deducida de
 * display_get_beam_position): un chunk queda "congelado" en L = E + 4. Un cambio
 * (escritura en pantalla o borde) hecho en un T < L se ve en él; uno hecho en T >= L
 * ya no. En Fuse, una escritura en T congela los chunks x < floor((T − E0)/4) de la
 * línea del haz, y el borde nuevo se aplica desde la columna floor((T − line_time)/4):
 * las dos cosas son "E + 4 <= T". Como el byte de pantalla y su atributo pertenecen al
 * mismo chunk, los dos se capturan juntos.
 * Con el T del cambio que zx48.c pasa (fin del ciclo de escritura; primer T del OUT):
 *  - OUT (n),A que termina en 14339..14342 cambia el borde justo en la posición del
 *    byte 16384 (docs §7): el cambio cae en 14336..14339 < 14340.
 *  - una escritura en 0x4000 que termina en T <= 14339 se ve en la línea 0.
 *
 * video_catch_up(t) dibuja todos los chunks con L <= t usando la memoria y el borde
 * actuales. Coste: una comparación cuando no hay nada nuevo que dibujar.
 */
#include "machine.h"

#define COLS        44                        /* chunks de 8 px por línea */
#define CHUNKS      (COLS * ZX_FB_HEIGHT)
#define FIRST_LATCH (3560 + 4)                /* L del chunk 0 */

static uint32_t fb[ZX_FB_WIDTH * ZX_FB_HEIGHT];
static uint32_t flash_frames;
static uint32_t pos;          /* siguiente chunk por dibujar (0..CHUNKS) */
static uint32_t next_latch;   /* L del chunk pos; UINT32_MAX si el frame está completo */

/* RGBA en memoria = 0xAABBGGRR en uint32 little-endian. Índice GRB + BRIGHT (docs §3). */
#define RGB(r, g, b) (0xFF000000u | (uint32_t)(b) << 16 | (uint32_t)(g) << 8 | (uint32_t)(r))
static const uint32_t palette[16] = {
    RGB(0x00, 0x00, 0x00), RGB(0x00, 0x00, 0xD7), RGB(0xD7, 0x00, 0x00), RGB(0xD7, 0x00, 0xD7),
    RGB(0x00, 0xD7, 0x00), RGB(0x00, 0xD7, 0xD7), RGB(0xD7, 0xD7, 0x00), RGB(0xD7, 0xD7, 0xD7),
    RGB(0x00, 0x00, 0x00), RGB(0x00, 0x00, 0xFF), RGB(0xFF, 0x00, 0x00), RGB(0xFF, 0x00, 0xFF),
    RGB(0x00, 0xFF, 0x00), RGB(0x00, 0xFF, 0xFF), RGB(0xFF, 0xFF, 0x00), RGB(0xFF, 0xFF, 0xFF),
};

static inline uint32_t latch_of(uint32_t chunk)
{
    return chunk >= CHUNKS ? 0xFFFFFFFFu
         : FIRST_LATCH + (chunk / COLS) * ZX_TSTATES_PER_LINE + (chunk % COLS) * 4;
}

static inline void fill8(uint32_t *p, uint32_t c)
{
    p[0] = c; p[1] = c; p[2] = c; p[3] = c;
    p[4] = c; p[5] = c; p[6] = c; p[7] = c;
}

/* Chunks [c0, c1) de la línea fy. El borde es el del último OUT ya aplicado: zx48.c
 * llama a catch_up ANTES de cambiar zx.last_fe. */
static void draw_span(uint32_t fy, uint32_t c0, uint32_t c1)
{
    uint32_t *p = fb + fy * ZX_FB_WIDTH + c0 * 8;
    uint32_t border = palette[zx.last_fe & 7];
    uint32_t y = fy - 48;
    uint32_t c = c0;
    if (y < 192) {
        for (; c < c1 && c < 6; c++, p += 8)
            fill8(p, border);
        if (c < c1 && c < 38) {
            /* Dirección del bitmap de la línea (docs §3) y de su fila de atributos. */
            const uint8_t *pix = zx.mem + (0x4000 | (y & 0xC0) << 5 | (y & 0x07) << 8 | (y & 0x38) << 2);
            const uint8_t *att = zx.mem + 0x5800 + (y >> 3) * 32;
            /* FLASH: tinta y papel se intercambian 16 frames de cada 32 (docs §3). */
            uint32_t flash = flash_frames & 16 ? 0xFF : 0x00;
            uint32_t end = c1 < 38 ? c1 : 38;
            for (; c < end; c++, p += 8) {
                uint32_t a = att[c - 6];
                uint32_t b = pix[c - 6] ^ (a & 0x80 ? flash : 0);
                uint32_t ink = palette[(a & 7) | (a >> 3 & 8)];
                uint32_t paper = palette[(a >> 3 & 15)];
                p[0] = b & 0x80 ? ink : paper;
                p[1] = b & 0x40 ? ink : paper;
                p[2] = b & 0x20 ? ink : paper;
                p[3] = b & 0x10 ? ink : paper;
                p[4] = b & 0x08 ? ink : paper;
                p[5] = b & 0x04 ? ink : paper;
                p[6] = b & 0x02 ? ink : paper;
                p[7] = b & 0x01 ? ink : paper;
            }
        }
    }
    for (; c < c1; c++, p += 8)
        fill8(p, border);
}

void video_catch_up(uint32_t t)
{
    if (t < next_latch)
        return;
    /* Nº de chunks con L <= t. */
    uint32_t d = t - FIRST_LATCH;
    uint32_t line = d / ZX_TSTATES_PER_LINE;
    uint32_t end;
    if (line >= ZX_FB_HEIGHT) {
        end = CHUNKS;
    } else {
        uint32_t col = (d % ZX_TSTATES_PER_LINE) / 4 + 1;
        end = line * COLS + (col < COLS ? col : COLS);
    }
    uint32_t fy = pos / COLS, c0 = pos % COLS;
    while (fy * COLS + COLS <= end) {
        draw_span(fy, c0, COLS);
        fy++;
        c0 = 0;
    }
    if (fy * COLS + c0 < end)
        draw_span(fy, c0, end - fy * COLS);
    pos = end;
    next_latch = latch_of(pos);
}

void video_reset(void)
{
    flash_frames = 0;
    pos = 0;
    next_latch = FIRST_LATCH;
    for (uint32_t i = 0; i < ZX_FB_WIDTH * ZX_FB_HEIGHT; i++)
        fb[i] = palette[0];
}

void video_end_frame(void)
{
    video_catch_up(0xFFFFFFFFu);
    pos = 0;
    next_latch = FIRST_LATCH;
    flash_frames++;
}

uint8_t *video_framebuffer(void) { return (uint8_t *)fb; }
