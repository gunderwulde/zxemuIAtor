/* 9 · Recursión: las torres de Hanoi
 *
 * Para mover n discos de una torre a otra: se mueven n-1 a la torre auxiliar, el
 * disco grande a su destino y los n-1 encima. La función se llama a sí misma; cada
 * llamada tiene sus parámetros en la pila (su propio marco con IX).
 */
#include <spectrum.h>

unsigned int moves = 0;

void hanoi(unsigned char n, char from, char to, char via)
{
    if (n == 0)
        return;
    hanoi(n - 1, from, via, to);
    moves++;
    printf("%2u: disco %u %c -> %c\n", moves, n, from, to);
    hanoi(n - 1, via, to, from);
}

int main(void)
{
    cls();
    print("Torres de Hanoi (4 discos)\n\n");
    hanoi(4, 'A', 'C', 'B');
    printf("\n%u movimientos (2x2x2x2 - 1)\n", moves);
    wait_key();
    return 0;
}
