/* 5 · Atributos animados: arco iris
 *
 * La memoria de atributos (0x5800, 32 bytes por fila de celdas) da el color de cada
 * celda: bit 7 FLASH, bit 6 BRIGHT, bits 3-5 PAPER, bits 0-2 INK. Con el bitmap vacío
 * sólo se ve el PAPER, así que basta escribir atributos para pintar bandas de color.
 * Cada frame se prepara una tira de 64 atributos y se copia a cada fila con memcpy,
 * empezando una banda más allá en cada fila: salen diagonales que se desplazan.
 * Pulsa ESPACIO para volver a BASIC.
 */
#include <spectrum.h>
#include <string.h>

#define ATTRS ((unsigned char *)0x5800)
#define ROWS  22                    /* las filas 22 y 23 son del editor de BASIC */

unsigned char strip[64];            /* 16 bandas de 4 celdas: dos vueltas de colores */

int main(void)
{
    unsigned char i, row, phase = 0;

    cls();                          /* bitmap a 0: sólo se ve el papel */
    while (!key_pressed(7, 0)) {    /* ESPACIO = semifila 7, bit 0 */
        for (i = 0; i < 64; i++)
            strip[i] = ((((i >> 2) + phase) & 7) << 3) | 0x40;  /* PAPER y BRIGHT */
        wait_frame();               /* copia al empezar el frame: sin cortes */
        for (row = 0; row < ROWS; row++)
            memcpy(ATTRS + row * 32, strip + ((row & 7) << 2), 32);
        border(phase & 7);
        phase++;
    }

    while (key_pressed(7, 0))       /* espera a soltar ESPACIO */
        ;
    set_color(0x38);                /* PAPER 7, INK 0: los colores de BASIC */
    cls();
    border(WHITE);
    return 0;
}
