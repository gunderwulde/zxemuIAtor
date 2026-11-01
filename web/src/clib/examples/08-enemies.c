/* 8 · Structs y arrays: una lista de enemigos que rebotan
 *
 * Cada enemigo es un struct con su posición, su velocidad y su color; todos están en
 * un array y se recorren con un puntero. Pulsa una tecla para salir.
 */
#include <spectrum.h>

#define N 6                         /* número de enemigos */
#define TOP 2                       /* primera fila del campo (la 0 es el título) */
#define BOTTOM 21                   /* última fila (22 y 23 son de BASIC) */

struct enemy {
    unsigned char x, y;             /* celda: columna 0..31, fila TOP..BOTTOM */
    signed char dx, dy;             /* -1 o +1 */
    unsigned char color;
};

struct enemy enemies[N];

/* Escribe ch en la celda del enemigo, con su color. */
void draw(struct enemy *e, char ch)
{
    at(e->x, e->y);
    ink(e->color);
    putchar(ch);
}

/* Avanza una celda y rebota en los bordes. */
void move(struct enemy *e)
{
    if ((e->x == 0 && e->dx < 0) || (e->x == 31 && e->dx > 0))
        e->dx = -e->dx;
    if ((e->y == TOP && e->dy < 0) || (e->y == BOTTOM && e->dy > 0))
        e->dy = -e->dy;
    e->x += e->dx;
    e->y += e->dy;
}

int main(void)
{
    unsigned char i, t = 0;
    struct enemy *e;

    paper(BLACK);
    cls();
    ink(WHITE);
    printf("%u enemigos. Pulsa una tecla.", N);

    for (i = 0; i < N; i++) {
        e = &enemies[i];
        e->x = 3 + i * 5;
        e->y = TOP + i * 3;
        e->dx = (i & 1) ? -1 : 1;
        e->dy = 1;
        e->color = i + 2;           /* 2 rojo, 3 magenta ... 7 blanco */
        draw(e, 'O');
    }

    while (!in_key()) {
        wait_frame();
        if (++t < 3)                /* se mueven cada 3 frames */
            continue;
        t = 0;
        for (i = 0, e = enemies; i < N; i++, e++) {
            draw(e, ' ');
            move(e);
            draw(e, 'O');
        }
    }
    while (in_key())
        ;
    return 0;
}
