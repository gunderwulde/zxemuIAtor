/* 6 · Sonido: la escala de Do mayor con beep
 *
 * beep(hz, ms) hace vibrar el altavoz (bit 4 del puerto 0xFE) a la frecuencia pedida
 * durante ms milisegundos. Mientras suena, el programa espera.
 */
#include <spectrum.h>

/* Frecuencias en Hz de Do4 a Do5 (La4 = 440 Hz). */
unsigned int notes[8] = { 262, 294, 330, 349, 392, 440, 494, 523 };
const char *names[8] = { "Do", "Re", "Mi", "Fa", "Sol", "La", "Si", "Do" };

int main(void)
{
    unsigned char i;

    cls();
    print("Escala de Do mayor\n\n");
    for (i = 0; i < 8; i++) {
        printf("%s %u Hz\n", names[i], notes[i]);
        beep(notes[i], 200);
    }
    print("\nFin");
    return 0;
}
