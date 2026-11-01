/* 4 · Gráficos: plot y line
 *
 * La pantalla tiene 256 x 192 píxeles; (0,0) es la esquina de arriba a la izquierda.
 * Cada celda de 8x8 píxeles tiene un solo par de colores (atributo): por eso se elige
 * la tinta antes de cls() y todo se dibuja en verde brillante.
 */
#include <spectrum.h>

int main(void)
{
    unsigned int i;                 /* int: el bucle llega a 256 */
    unsigned char x, y;

    border(BLACK);
    paper(BLACK);
    ink(GREEN);
    bright(1);
    cls();

    /* Marco alrededor de las 22 filas de arriba (176 píxeles). */
    line(0, 0, 255, 0);
    line(255, 0, 255, 175);
    line(255, 175, 0, 175);
    line(0, 175, 0, 0);

    /* Abanico de líneas desde el centro hasta los bordes de arriba y de abajo. */
    for (i = 0; i < 256; i += 16) {
        line(128, 88, i, 0);
        line(128, 88, i, 175);
    }

    /* Una trama de puntos en la esquina: un píxel sí y otro no. */
    for (y = 8; y < 40; y += 2)
        for (x = 8; x < 40; x += 2)
            plot(x, y);

    at(0, 22);
    print("Pulsa una tecla");
    wait_key();
    return 0;
}
