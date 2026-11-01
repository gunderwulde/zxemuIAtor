/* stdlib.h mínimo (L1): rand/srand/abs en stdlib.asm; exit() la define el crt0. */
#ifndef STDLIB_H
#define STDLIB_H

#pragma link "stdlib.asm"

#ifndef NULL
#define NULL ((void *)0)
#endif

#define RAND_MAX 32767

int rand(void);                 /* 0..RAND_MAX, xorshift de 16 bits (periodo 65535) */
void srand(unsigned int seed);
int abs(int n);
void exit(int code);            /* vuelve a BASIC; PRINT USR da code */

#endif
