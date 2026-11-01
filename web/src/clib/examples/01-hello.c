/* 1 · Hola mundo con colores
 *
 * Lo mínimo de un programa C para el Spectrum: incluir la librería, poner colores y
 * escribir texto. Pulsa Ctrl+Enter para ejecutarlo y una tecla para volver a BASIC.
 */
#include <spectrum.h>

int main(void)
{
    unsigned char c;

    border(BLUE);           /* el borde también se queda así al volver a BASIC */
    paper(BLACK);           /* color de fondo para lo que se escriba y para cls() */
    ink(WHITE);
    cls();                  /* borra la pantalla con PAPER negro */

    at(10, 4);              /* columna 10, fila 4 (32 columnas x 24 filas) */
    bright(1);              /* BRIGHT: colores más intensos */
    ink(YELLOW);
    print("Hola, mundo!");
    bright(0);

    /* Una línea con cada color de tinta (1 = azul ... 7 = blanco). */
    for (c = 1; c < 8; c++) {
        at(6, 7 + c);
        ink(c);
        printf("Tinta %d: Spectrum", c);
    }

    ink(WHITE);
    at(2, 20);
    print("Pulsa una tecla para volver");
    wait_key();
    return 0;               /* vuelve a BASIC; PRINT USR mostraría este valor */
}
