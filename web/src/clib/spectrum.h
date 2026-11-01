/* spectrum.h — librería básica del ZX Spectrum 48K para el compilador de C (L1).
 *
 * Coordenadas: píxeles x = 0..255 (izquierda a derecha), y = 0..191 (arriba abajo);
 * celdas de texto col = 0..31, row = 0..23. Los colores son 0..7 (constantes abajo).
 * Todo está escrito en ensamblador (zx*.asm) siguiendo docs/c-abi.md; cada .asm se
 * enlaza entero (ocupa unos 2,3 KB en total).
 */
#ifndef SPECTRUM_H
#define SPECTRUM_H

#pragma link "zxgfx.asm"
#pragma link "zxtext.asm"
#pragma link "zxinput.asm"
#pragma link "zxsound.asm"
#pragma link "zxint.asm"

/* Colores (índice GRB del Spectrum) */
#define BLACK   0
#define BLUE    1
#define RED     2
#define MAGENTA 3
#define GREEN   4
#define CYAN    5
#define YELLOW  6
#define WHITE   7

/* ---- Texto (rejilla propia de 32x24; no usa la ROM salvo su fuente) ---- */
void cls(void);                         /* borra con el color actual; cursor a (0,0) */
void at(unsigned char col, unsigned char row);
int  putchar(int c);                    /* '\n' = nueva línea; 144..164 = UDG */
void print(const char *s);
int  printf(const char *fmt, ...);      /* %d %i %u %x %X %s %c %%, anchura y 0: "%05u" */

/* ---- Color del texto que se escriba después (y de cls) ---- */
void ink(unsigned char c);
void paper(unsigned char c);
void bright(unsigned char on);
void flash(unsigned char on);
void set_color(unsigned char a);        /* atributo completo: FLASH*128+BRIGHT*64+PAPER*8+INK */
void border(unsigned char c);           /* también actualiza BORDCR, como BORDER de BASIC */

/* ---- Atributos de celda ---- */
unsigned char attr(unsigned char col, unsigned char row);
void set_attr(unsigned char col, unsigned char row, unsigned char a);

/* ---- Direcciones de pantalla ---- */
unsigned int zx_pxaddr(unsigned char x, unsigned char y);      /* byte del bitmap del píxel */
unsigned int zx_attraddr(unsigned char col, unsigned char row); /* 0x5800 + 32*row + col */

/* ---- Gráficos (y >= 192 no se dibuja) ---- */
void plot(unsigned char x, unsigned char y);
void unplot(unsigned char x, unsigned char y);
unsigned char point(unsigned char x, unsigned char y);          /* 1 si el píxel está a tinta */
void line(unsigned char x0, unsigned char y0, unsigned char x1, unsigned char y1);

/* ---- Sprites: filas de arriba abajo, 1 byte (8x8) o 2 bytes (16x16) por fila ---- */
#define SPR_XOR 0       /* pantalla ^= sprite: dibujarlo otra vez lo borra */
#define SPR_OR  1       /* pantalla |= sprite */
void sprite8(unsigned char x, unsigned char y, const void *gfx, unsigned char mode);
void sprite16(unsigned char x, unsigned char y, const void *gfx, unsigned char mode);
/* pantalla = (pantalla & mask) | gfx; mask a 1 = se ve el fondo */
void sprite8_mask(unsigned char x, unsigned char y, const void *gfx, const void *mask);
void sprite16_mask(unsigned char x, unsigned char y, const void *gfx, const void *mask);

/* ---- Teclado y joysticks ---- */
unsigned char in_key(void);     /* ASCII de la tecla pulsada o 0; ENTER = 13, CAPS+0 = 8 */
unsigned char wait_key(void);   /* espera a soltar todo y luego a una tecla; la devuelve */
unsigned char key_pressed(unsigned char row, unsigned char bit); /* semifila 0..7, bit 0..4 */

#define JOY_RIGHT 1
#define JOY_LEFT  2
#define JOY_DOWN  4
#define JOY_UP    8
#define JOY_FIRE  16
unsigned char joy_kempston(void);   /* puerto 0x1F; 0 si no hay interfaz */
unsigned char joy_sinclair1(void);  /* teclas 6 7 8 9 0 */
unsigned char joy_sinclair2(void);  /* teclas 1 2 3 4 5 */
unsigned char joy_cursor(void);     /* teclas 5 6 7 8 y 0 */
unsigned char joy_qaop(void);       /* Q A O P y SPACE */

/* ---- Sonido ---- */
void beep(unsigned int hz, unsigned int ms);    /* bloquea mientras suena */

/* ---- Tiempo e interrupciones ---- */
void wait_frame(void);              /* HALT: espera a la interrupción de 50 Hz */
unsigned int frames(void);          /* contador FRAMES de la ROM (50 por segundo) */
void im2_install(void *isr);        /* llama a isr() en cada frame (IM 2) */
void im2_remove(void);              /* vuelve a IM 1 */

#endif
