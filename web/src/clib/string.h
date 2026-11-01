/* string.h mínimo (L1): implementación en string.asm. */
#ifndef STRING_H
#define STRING_H

#pragma link "string.asm"

#ifndef NULL
#define NULL ((void *)0)
#endif

void *memcpy(void *dst, const void *src, unsigned int n);
void *memset(void *dst, int c, unsigned int n);
int memcmp(const void *a, const void *b, unsigned int n);
unsigned int strlen(const char *s);
char *strcpy(char *dst, const char *src);
int strcmp(const char *a, const char *b);

#endif
