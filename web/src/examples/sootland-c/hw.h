/* Sootland (versión en C) — acceso al hardware y a la ROM.
 *
 * Es lo único que sigue en ensamblador: lo que el compilador no puede expresar (IN/OUT, el
 * registro R, llamadas a rutinas de la ROM con sus registros) y los bucles de temporización,
 * que dependen del número exacto de T-states. Todo lo demás del juego está en engine.c.
 */
#ifndef HW_H
#define HW_H

unsigned char inp(unsigned int port);
void outp(unsigned int port, unsigned char v);
unsigned char rreg(void);                       /* registro R (refresco): casi aleatorio */

void chan_open(unsigned char ch);               /* ROM 1601h: abre el canal (2 = pantalla) */
void rst10(unsigned char c);                    /* RST 10h: imprime un carácter o código de control */
void print_num(unsigned char n);                /* ROM 2D28h + 2DE3h: imprime n con la calculadora */
void print_str(const char *s, unsigned int n);  /* ROM 203Ch: imprime n bytes */
/* ROM 0556h (LD-BYTES): carga n bytes con el flag dado en addr; 1 si fue bien, 0 si falló. */
unsigned char ld_bytes(unsigned int addr, unsigned int n, unsigned char flag);
void jump_ending(void);                         /* salta al bloque final cargado (no vuelve) */

void spin(unsigned int n);                      /* espera 26*n T-states (n = 0: 65536 vueltas) */
void long_pause(void);                          /* ~7 s: la pausa tras perder una vida */
/* Escribe 14 valores en los registros del AY y reproduce el chasquido por el altavoz. */
void ay_play(const unsigned char *regs);

/* Compone un sprite (struct sprite de engine.c) sobre la escena en BG_BUFFER guardando el fondo, y lo deshace. */
void sprite_draw(void *s);
void sprite_restore(void *s);

#endif
