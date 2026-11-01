/* 3 · Teclado: eco de teclas y una estrella que se mueve con Q A O P
 *
 * in_key() devuelve el código ASCII de la tecla pulsada (0 si ninguna) y joy_qaop()
 * lee Q A O P como si fueran un joystick. wait_frame() espera al siguiente frame
 * (1/50 s): el bucle va siempre al mismo ritmo.
 */
#include <spectrum.h>

int main(void)
{
    unsigned char x = 15, y = 12;   /* posición de la estrella */
    unsigned char k, j, t = 0;

    cls();
    print("Pulsa teclas: se ven abajo.\n");
    print("Q A O P mueven la estrella.\n");
    print("ENTER vuelve a BASIC.");
    at(x, y);
    putchar('*');

    for (;;) {
        wait_frame();
        k = in_key();
        if (k == 13)                /* ENTER */
            break;
        if (k >= 32 && k < 128) {
            at(0, 20);
            printf("Tecla: %c  codigo: %3u", k, k);
        }

        if (++t < 4)                /* la estrella avanza una celda cada 4 frames */
            continue;
        t = 0;
        j = joy_qaop();
        if (j) {
            at(x, y);
            putchar(' ');           /* borra la estrella en su sitio viejo */
            if ((j & JOY_LEFT) && x > 0)
                x--;
            if ((j & JOY_RIGHT) && x < 31)
                x++;
            if ((j & JOY_UP) && y > 4)
                y--;
            if ((j & JOY_DOWN) && y < 18)
                y++;
            at(x, y);
            putchar('*');
        }
    }

    while (in_key())                /* espera a soltar ENTER: si no, BASIC la vería */
        ;
    return 0;
}
