/* 2 · Bucles y aritmética: la tabla de multiplicar
 *
 * Dos bucles for anidados, una función con recursión sencilla y la aritmética entera
 * del Z80: int y unsigned son de 16 bits (-32768..32767 y 0..65535).
 */
#include <spectrum.h>

/* n! con unsigned: cabe hasta 8! = 40320 */
unsigned int factorial(unsigned char n)
{
    if (n < 2)
        return 1;
    return n * factorial(n - 1);
}

int main(void)
{
    unsigned char i, j;
    int a;
    unsigned int u;

    cls();
    print("    Tabla de multiplicar\n\n");
    for (i = 1; i <= 9; i++) {
        for (j = 1; j <= 9; j++)
            printf("%3u", i * j);       /* %3u: 3 columnas por número */
        putchar('\n');
    }

    putchar('\n');
    printf("8! = %u\n", factorial(8));
    a = -1000;
    printf("%d / 7 = %d, resto %d\n", a, a / 7, a % 7);  /* C trunca hacia 0 */
    u = 65535;
    u = u + 1;                          /* desborda: vuelve a 0 */
    printf("65535 + 1 = %u (16 bits)\n", u);
    printf("1000 en hex = %x\n", 1000);

    wait_key();
    return 0;
}
