/*
 * machine.h — contrato interno entre los módulos de la máquina 48K.
 * CONGELADO; sólo lo modifica el coordinador. Permite que M1 (zx48.c, video.c),
 * M2 (audio.c), M3 (tape.c, snap.c) y D1 (debug.c) trabajen en paralelo.
 *
 * Todo el estado de la máquina está en un único struct estático `zx` (AGENTS.md §4.1.5).
 * Cada módulo guarda su estado privado como `static` en su propio .c.
 */
#ifndef MACHINE_H
#define MACHINE_H

#include "base.h"

typedef struct {
    uint8_t  mem[65536];     /* 0x0000-0x3FFF ROM, resto RAM */
    ZxRegs   cpu;
    uint32_t t;              /* T-state dentro del frame actual (puede pasar de 69888 un instante) */
    uint32_t frame;          /* frames completados desde el reset */
    uint8_t  last_fe;        /* último byte escrito en un puerto par (borde, MIC, EAR) */
    uint8_t  issue;          /* 2 o 3 */
    uint8_t  keys[8];        /* semifilas activas a nivel bajo: 0x1F = ninguna pulsada */
    uint8_t  int_enabled;    /* 1 normal; 0 sólo desde hooks de test */
    uint8_t  _pad;
} Zx48;

extern Zx48 zx;
extern uint8_t zx_io[ZX_IO_BUFFER_SIZE];   /* zona de intercambio de ficheros con JS */

/* ---- video.c (M1) ----
 * video_catch_up(t): dibuja todo lo que la ULA haya emitido ANTES del T-state t con
 * el estado actual de memoria y borde. zx48.c la llama antes de cada escritura en
 * 0x4000-0x5AFF y antes de cambiar el borde, con el T exacto en que el cambio se hace
 * visible para la ULA.
 * video_end_frame(): completa el frame y avanza el contador de FLASH. */
void     video_reset(void);
void     video_catch_up(uint32_t t);
void     video_end_frame(void);
uint8_t *video_framebuffer(void);

/* ---- audio.c (M2) ----
 * audio_out(t, fe): registrar el valor escrito en el puerto 0xFE en el T-state t
 * (sólo importan bits 3 y 4; audio.c decide si hay cambio de nivel).
 * audio_end_frame(frame_len): cierra el frame de frame_len T-states. */
void     audio_reset(void);
void     audio_out(uint32_t t, uint8_t fe);
void     audio_end_frame(uint32_t frame_len);

/* ---- tape.c (M3) ----
 * tape_trap(): zx48.c la llama cuando PC == 0x0556 (LD-BYTES) en un límite de
 * instrucción. Devuelve 1 si ha resuelto la carga (registros y PC ya en el estado de
 * retorno de la ROM), 0 si no hay cinta y la ROM debe seguir normalmente. */
#define TAPE_LD_BYTES 0x0556
void     tape_reset(void);
int      tape_trap(void);

/* ---- debug.c (D1) ---- */
extern uint8_t  debug_bp_map[65536 / 8];
extern uint32_t debug_bp_count;

static inline int debug_is_bp(uint16_t pc)
{
    return debug_bp_count && (debug_bp_map[pc >> 3] >> (pc & 7) & 1);
}

#endif /* MACHINE_H */
