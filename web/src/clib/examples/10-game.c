/* 10 · Mini-juego: recoge las monedas ($) y esquiva las rocas (#)
 *
 * Junta todo lo anterior: structs y arrays para los objetos que caen, rand() para
 * dónde aparecen, joysticks o teclado para moverse, beep() para los efectos y
 * printf() para el marcador. Q A O P, cursores (5-8) o Sinclair (6-0); 3 vidas.
 */
#include <spectrum.h>
#include <stdlib.h>

#define MAXOBJ 8
#define ROW 21                      /* fila del jugador */

struct object {
    unsigned char x, y;
    char kind;                      /* '$' moneda, '#' roca */
    unsigned char active;
};

struct object objs[MAXOBJ];
unsigned int score;
unsigned char lives, px;

void put(unsigned char x, unsigned char y, char ch, unsigned char color)
{
    at(x, y);
    ink(color);
    putchar(ch);
}

void status(void)
{
    at(0, 0);
    paper(BLUE);
    ink(WHITE);
    printf(" PUNTOS %05u        VIDAS %u ", score, lives);
    paper(BLACK);
}

/* Activa un objeto libre en la fila 1, en una columna al azar. */
void spawn(void)
{
    unsigned char i;
    for (i = 0; i < MAXOBJ; i++) {
        if (!objs[i].active) {
            objs[i].active = 1;
            objs[i].x = rand() & 31;
            objs[i].y = 1;
            objs[i].kind = (rand() & 3) == 0 ? '$' : '#';
            return;
        }
    }
}

/* Baja todos los objetos una fila y mira si tocan al jugador. */
void fall(void)
{
    unsigned char i;
    struct object *o;
    for (i = 0; i < MAXOBJ; i++) {
        o = &objs[i];
        if (!o->active)
            continue;
        put(o->x, o->y, ' ', BLACK);
        o->y++;
        if (o->y == ROW && o->x == px) {
            o->active = 0;
            if (o->kind == '$') {
                score += 10;
                beep(880, 15);
            } else {
                lives--;
                beep(110, 80);
            }
            status();
        } else if (o->y > ROW) {
            o->active = 0;
        } else {
            put(o->x, o->y, o->kind, o->kind == '$' ? YELLOW : RED);
        }
    }
}

int main(void)
{
    unsigned char i, j, t = 0;

    srand(frames());                /* semilla: los frames desde que se encendió */
    border(BLACK);
    paper(BLACK);
    cls();
    score = 0;
    lives = 3;
    px = 15;
    for (i = 0; i < MAXOBJ; i++)
        objs[i].active = 0;
    status();

    while (lives) {
        wait_frame();
        t++;
        if (t & 1) {                /* el jugador se mueve cada 2 frames */
            j = joy_qaop() | joy_cursor() | joy_sinclair1();
            put(px, ROW, ' ', BLACK);
            if ((j & JOY_LEFT) && px > 0)
                px--;
            if ((j & JOY_RIGHT) && px < 31)
                px++;
        }
        if ((t & 3) == 0) {         /* los objetos caen cada 4 */
            if ((rand() & 3) == 0)
                spawn();
            fall();
        }
        put(px, ROW, 'A', YELLOW);
    }

    at(11, 10);
    ink(WHITE);
    flash(1);
    print("GAME OVER");
    flash(0);
    at(8, 12);
    print("Pulsa una tecla");
    wait_key();
    return 0;
}
