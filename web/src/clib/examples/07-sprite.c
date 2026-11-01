/* 7 · Sprite de 16x16 que se mueve sin parpadeo
 *
 * sprite16() dibuja 16 filas de 2 bytes en cualquier píxel. En modo SPR_XOR dibujar
 * dos veces en el mismo sitio lo borra, así que mover es: borrar en la posición vieja
 * y dibujar en la nueva. Se hace justo después de wait_frame(), mientras el haz de la
 * tele está en el borde de arriba: nunca se ve el sprite a medio dibujar.
 * Se mueve con Q A O P o los cursores (5 6 7 8). ENTER sale. (joy_kempston() sólo si
 * hay interfaz Kempston: sin ella el puerto 0x1F devuelve basura del bus flotante.)
 */
#include <spectrum.h>

/* Una nave: cada fila son 2 bytes (16 píxeles), bit 7 del primero a la izquierda. */
const unsigned char ship[32] = {
    0x01, 0x80,
    0x03, 0xC0,
    0x03, 0xC0,
    0x07, 0xE0,
    0x07, 0xE0,
    0x0F, 0xF0,
    0x0D, 0xB0,
    0x1F, 0xF8,
    0x3F, 0xFC,
    0x7F, 0xFE,
    0xFF, 0xFF,
    0xFB, 0xDF,
    0xF1, 0x8F,
    0x60, 0x06,
    0x20, 0x04,
    0x00, 0x00
};

int main(void)
{
    unsigned char x = 120, y = 88;  /* esquina de arriba a la izquierda del sprite */
    unsigned char ox, oy, j;

    border(BLACK);
    paper(BLACK);
    ink(CYAN);
    bright(1);
    cls();
    print("QAOP o cursores. ENTER sale");
    sprite16(x, y, ship, SPR_XOR);

    while (in_key() != 13) {
        j = joy_qaop() | joy_cursor();
        wait_frame();
        if (j) {
            ox = x;
            oy = y;
            if ((j & JOY_LEFT) && x > 0)
                x -= 2;
            if ((j & JOY_RIGHT) && x < 240)
                x += 2;
            if ((j & JOY_UP) && y > 16)
                y -= 2;
            if ((j & JOY_DOWN) && y < 174)
                y += 2;
            sprite16(ox, oy, ship, SPR_XOR);   /* borra */
            sprite16(x, y, ship, SPR_XOR);     /* dibuja */
        }
    }
    while (in_key())
        ;
    return 0;
}
