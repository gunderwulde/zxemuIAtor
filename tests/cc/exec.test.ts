// K1: programas C ejecutados en el núcleo real. Cada valor esperado está calculado a
// mano a partir de C99 con int de 16 bits (complemento a 2, char sin signo por defecto)
// y se explica al lado cuando no es obvio. Nunca sale del compilador.
import { describe, expect, it } from "vitest";
import { runC } from "./harness";

describe("aritmética de 16 bits", () => {
  it("desbordes con signo y sin signo (envolvente, como el hardware)", async () => {
    const r = await runC(`
int r[12];
unsigned u[6];
int main(void) {
  int a = 32767, b = -32768, c = 300, m1 = -1;
  unsigned x = 65535u, y = 0;
  r[0] = a + 1;      /* 8000h = -32768 */
  r[1] = b - 1;      /* 7FFFh = 32767 */
  r[2] = -b;         /* -(-32768) = 8000h */
  r[3] = a * 2;      /* FFFEh = -2 */
  r[4] = c * c;      /* 90000 mod 65536 = 24464 */
  r[5] = 300 * 300;  /* plegado: igual */
  r[6] = ~a;         /* 8000h */
  r[7] = m1 * m1;    /* 1 */
  r[8] = a + b;      /* -1 */
  r[9] = -m1;        /* 1 */
  u[0] = x + 1;      /* 0 */
  u[1] = y - 1;      /* 65535 */
  u[2] = x * x;      /* (2^16-1)^2 mod 2^16 = 1 */
  u[3] = ~y;         /* 65535 */
  u[4] = 255u * 257u;/* 65535 */
  u[5] = x / 3u;     /* 21845 */
  return 0;
}`);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => r.s16("r", i))).toEqual([-32768, 32767, -32768, -2, 24464, 24464, -32768, 1, -1, 1]);
    expect([0, 1, 2, 3, 4, 5].map((i) => r.u16("u", i))).toEqual([0, 65535, 1, 65535, 65535, 21845]);
  });

  it("multiplicación en tiempo de ejecución (__mul16 y sumas/desplazamientos)", async () => {
    const r = await runC(`
int r[12];
int main(void) {
  int a = 123, b = 456, x = 1234, n3 = -3, s = 7, f = 255, g = 257;
  r[0] = a * b;      /* 56088 - 65536 = -9448 */
  r[1] = n3 * s;     /* -21 */
  r[2] = f * g;      /* 65535 = -1 */
  r[3] = x * 10;     /* 12340 */
  r[4] = x * 100;    /* 123400 - 65536 = 57864 -> -7672 */
  r[5] = x * 7;      /* 8638 */
  r[6] = x * 1000;   /* 1234000 - 18*65536 = 54352 -> -11184 */
  r[7] = n3 * 16;    /* -48 */
  r[8] = x * 0;      /* 0 */
  r[9] = b * a * 0 + a; /* 123 */
  r[10] = n3 * n3 * n3; /* -27 */
  r[11] = x * 12345; /* 1234*12345 = 15233730; mod 65536 = 15233730 - 232*65536 = 29378 */
  return 0;
}`);
    expect(Array.from({ length: 12 }, (_, i) => r.s16("r", i))).toEqual([-9448, -21, -1, 12340, -7672, 8638, -11184, -48, 0, 123, -27, 29378]);
  });

  it("división y módulo: truncamiento hacia cero (C99 6.5.5)", async () => {
    const r = await runC(`
int q[12], m[12];
unsigned uq[8], um[8];
int main(void) {
  int p7 = 7, n7 = -7, p2 = 2, n2 = -2, big = 32767, low = -32768, one = 1, n1 = -1;
  unsigned a = 65535u, b = 10, c = 40000u, d = 3, e = 50000u, f = 0x9000u, g = 1000, h = 0x8001u;
  q[0] = p7 / p2;  m[0] = p7 % p2;   /*  3,  1 */
  q[1] = n7 / p2;  m[1] = n7 % p2;   /* -3, -1 */
  q[2] = p7 / n2;  m[2] = p7 % n2;   /* -3,  1 */
  q[3] = n7 / n2;  m[3] = n7 % n2;   /*  3, -1 */
  q[4] = low / one; m[4] = low % one;/* -32768, 0 */
  q[5] = big / low; m[5] = big % low;/* 0, 32767 */
  q[6] = low / p2; m[6] = low % p2;  /* -16384, 0 */
  q[7] = n7 / 4;   m[7] = n7 % 4;    /* -1, -3 (constante potencia de 2 con signo) */
  q[8] = -8 / 4;   m[8] = n1 / 2;    /* plegado -2; ejecución 0 */
  q[9] = low / 2;  m[9] = low / 256; /* -16384, -128 */
  q[10] = n1 / 256; m[10] = big / n1;/* 0, -32767 */
  q[11] = p7 / 4;  m[11] = n7 % 1;   /* 1, 0 */
  uq[0] = a / b; um[0] = a % b;      /* 6553, 5 */
  uq[1] = c / d; um[1] = c % d;      /* 13333, 1 */
  uq[2] = e / c; um[2] = e % c;      /* 1, 10000 (divisor > 8000h) */
  uq[3] = a / a; um[3] = a % a;      /* 1, 0 */
  uq[4] = g / f; um[4] = g % f;      /* 0, 1000 */
  uq[5] = a / h; um[5] = a % h;      /* 1, 32766 */
  uq[6] = a / 16; um[6] = a % 16;    /* 4095, 15 */
  uq[7] = c / 256; um[7] = c % 256;  /* 156, 64 (40000 = 156*256 + 64) */
  return 0;
}`);
    const s = (n: string, k: number) => Array.from({ length: k }, (_, i) => r.s16(n, i));
    const u = (n: string, k: number) => Array.from({ length: k }, (_, i) => r.u16(n, i));
    expect(s("q", 12)).toEqual([3, -3, -3, 3, -32768, 0, -16384, -1, -2, -16384, 0, 1]);
    expect(s("m", 12)).toEqual([1, -1, 1, -1, 0, 32767, 0, -3, 0, -128, -32767, 0]);
    expect(u("uq", 8)).toEqual([6553, 13333, 1, 1, 0, 1, 4095, 156]);
    expect(u("um", 8)).toEqual([5, 1, 10000, 0, 1000, 32766, 15, 64]);
  });

  it("desplazamientos: >> aritmético con signo, lógico sin signo; cuentas variables", async () => {
    const r = await runC(`
int r[10];
unsigned u[8];
int main(void) {
  int s = -16, n = 4, e = 8, v = 0x1234, m256 = -256, z = 15;
  unsigned w = 0xF000u, h = 0x8001u;
  r[0] = s >> 2;     /* -4 */
  r[1] = s << 3;     /* -128 */
  r[2] = 1 << n;     /* 16 */
  r[3] = m256 >> n;  /* -16 */
  r[4] = v << e;     /* 3400h = 13312 */
  r[5] = v >> e;     /* 12h = 18 */
  r[6] = s >> z;     /* -1 */
  r[7] = v >> 12;    /* 1 */
  r[8] = s >> 9;     /* -1 */
  r[9] = 1 << 15;    /* 8000h = -32768 */
  u[0] = w >> n;     /* 0F00h = 3840 */
  u[1] = h >> 1;     /* 4000h = 16384 */
  u[2] = h >> 15;    /* 1 */
  u[3] = w >> 12;    /* 15 */
  u[4] = h << 1;     /* 2 */
  u[5] = w >> e;     /* 0F0h = 240 */
  u[6] = w >> 9;     /* 78h = 120 */
  u[7] = h << z;     /* 8000h */
  return 0;
}`);
    expect(Array.from({ length: 10 }, (_, i) => r.s16("r", i))).toEqual([-4, -128, 16, -16, 13312, 18, -1, 1, -1, -32768]);
    expect(Array.from({ length: 8 }, (_, i) => r.u16("u", i))).toEqual([3840, 16384, 1, 15, 2, 240, 120, 0x8000]);
  });

  it("bit a bit y operadores compuestos", async () => {
    const r = await runC(`
int r[14];
int main(void) {
  int a = 0x0F0F, b = 0x00FF, x = 10;
  r[0] = a & b;   /* 000Fh */
  r[1] = a | b;   /* 0FFFh */
  r[2] = a ^ b;   /* 0FF0h */
  r[3] = a & 0xFF00; /* 0F00h */
  r[4] = a | 0x8000; /* 8F0Fh = -28913 */
  r[5] = a ^ -1;  /* F0F0h = -3856 */
  x += 5;  r[6] = x;   /* 15 */
  x -= 20; r[7] = x;   /* -5 */
  x *= 3;  r[8] = x;   /* -15 */
  x /= 2;  r[9] = x;   /* -7 */
  x %= 4;  r[10] = x;  /* -3 */
  x <<= 4; r[11] = x;  /* -48 */
  x >>= 2; r[12] = x;  /* -12 */
  x &= 0xFF; x |= 0x100; x ^= 3; r[13] = x; /* -12 = FFF4h; &FF = F4h; |100h = 1F4h; ^3 = 1F7h = 503 */
  return 0;
}`);
    expect(Array.from({ length: 14 }, (_, i) => r.s16("r", i))).toEqual([0xf, 0xfff, 0xff0, 0xf00, -28913, -3856, 15, -5, -15, -7, -3, -48, -12, 503]);
  });
});

describe("tipos de 8 bits", () => {
  it("char sin signo por defecto, promociones a int y truncado al asignar", async () => {
    const r = await runC(`
int r[14];
unsigned char uc[4];
signed char sc[4];
int main(void) {
  char c = 200;              /* char = unsigned char */
  unsigned char d = 255;
  signed char s = -100, t = 127;
  r[0] = c + c;              /* 400: se suman como int */
  r[1] = (unsigned char)(c + c); /* 400 - 256 = 144 */
  r[2] = s - 100;            /* -200 */
  r[3] = (signed char)(s - 100); /* -200 + 256 = 56 */
  r[4] = d + 1;              /* 256 */
  d++; r[5] = d;             /* 0 */
  t++; r[6] = t;             /* -128 */
  r[7] = c > -1;             /* 1: 200 > -1 como int */
  r[8] = s < 0;              /* 1 */
  c = -1; r[9] = c;          /* 255 */
  s = 255; r[10] = s;        /* -1 */
  r[11] = (char)-1 == 255;   /* 1 */
  uc[0] = 250; uc[0] += 10; r[12] = uc[0]; /* 260 - 256 = 4 */
  sc[0] = 100; sc[0] += 100; r[13] = sc[0]; /* 200 - 256 = -56 */
  uc[1] = uc[0]--; sc[1] = --sc[0];  /* uc[1] = 4, uc[0] = 3; sc[0] = -57 = sc[1] */
  uc[2] = 0; uc[2]--;        /* 255 */
  sc[2] = -128; sc[2]--;     /* 127 */
  return 0;
}`);
    expect(Array.from({ length: 14 }, (_, i) => r.s16("r", i))).toEqual([400, 144, -200, 56, 256, 0, -128, 1, 1, 255, -1, 1, 4, -56]);
    expect([r.u8("uc", 0), r.u8("uc", 1), r.u8("uc", 2)]).toEqual([3, 4, 255]);
    expect([r.s8("sc", 0), r.s8("sc", 1), r.s8("sc", 2)]).toEqual([-57, -57, 127]);
  });

  it("char como argumento y retorno de función", async () => {
    const r = await runC(`
int r[6];
signed char neg(signed char x) { return -x; }
unsigned char inc(unsigned char x) { return x + 1; }
int add(char a, signed char b) { return a + b; }
int main(void) {
  r[0] = neg(5);       /* -5 */
  r[1] = neg(-128);    /* -(-128) = 128 -> signed char -128 */
  r[2] = inc(255);     /* 0 */
  r[3] = inc(41);      /* 42 */
  r[4] = add(200, -1); /* 199 */
  r[5] = add(300, 300);/* char 300 -> 44; signed char 300 -> 44: 88 */
  return 0;
}`);
    expect(Array.from({ length: 6 }, (_, i) => r.s16("r", i))).toEqual([-5, -128, 0, 42, 199, 88]);
  });
});

describe("comparaciones", () => {
  it("con y sin signo, en los límites", async () => {
    const r = await runC(`
int r[16];
int main(void) {
  int m1 = -1, p1 = 1, lo = -32768, hi = 32767, z = 0;
  unsigned um1 = 65535u, u1 = 1, u8000 = 32768u, u7fff = 32767u;
  r[0] = m1 < p1;        /* 1 */
  r[1] = um1 < u1;       /* 0 */
  r[2] = m1 < u1;        /* 0: -1 se convierte a 65535 */
  r[3] = lo < hi;        /* 1 */
  r[4] = hi > lo;        /* 1 */
  r[5] = u8000 > u7fff;  /* 1 */
  r[6] = lo <= lo;       /* 1 */
  r[7] = hi >= lo;       /* 1 */
  r[8] = lo > z;         /* 0 */
  r[9] = m1 >= z;        /* 0 */
  r[10] = z <= m1;       /* 0 */
  r[11] = um1 > 32767;   /* 1 */
  r[12] = lo < -32767;   /* 1 */
  r[13] = hi > 32766;    /* 1 */
  r[14] = (m1 == um1);   /* 1: -1 convertido a unsigned */
  r[15] = (lo != hi) + (hi != hi); /* 1 */
  return 0;
}`);
    expect(Array.from({ length: 16 }, (_, i) => r.s16("r", i))).toEqual([1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1]);
  });

  it("todas las comparaciones contra constantes y variables, en if", async () => {
    // Para cada par (a,b) se calculan las 6 relaciones con signo como bits b0..b5:
    // ==, !=, <, >, <=, >=.
    const r = await runC(`
int pairs[12] = { 5, 5,  -3, 4,  4, -3,  -32768, 32767,  0, -1,  100, 100 };
int res[6];
unsigned ures[6];
unsigned upairs[12] = { 5, 5,  65533u, 4,  4, 65533u,  32768u, 32767,  0, 65535u,  0, 0 };
int main(void) {
  int i;
  for (i = 0; i < 6; i++) {
    int a = pairs[2*i], b = pairs[2*i+1], m = 0;
    unsigned ua = upairs[2*i], ub = upairs[2*i+1], um = 0;
    if (a == b) m |= 1;  if (a != b) m |= 2;  if (a < b) m |= 4;
    if (a > b) m |= 8;   if (a <= b) m |= 16; if (a >= b) m |= 32;
    if (ua == ub) um |= 1;  if (ua != ub) um |= 2;  if (ua < ub) um |= 4;
    if (ua > ub) um |= 8;   if (ua <= ub) um |= 16; if (ua >= ub) um |= 32;
    res[i] = m; ures[i] = um;
  }
  return 0;
}`);
    // igual: 1+16+32 = 49; menor: 2+4+16 = 22; mayor: 2+8+32 = 42
    expect(Array.from({ length: 6 }, (_, i) => r.u16("res", i))).toEqual([49, 22, 42, 22, 42, 49]);
    // sin signo: 5=5; 65533>4; 4<65533; 32768>32767; 0<65535; 0=0
    expect(Array.from({ length: 6 }, (_, i) => r.u16("ures", i))).toEqual([49, 42, 22, 42, 22, 49]);
  });

  it("comparaciones de char con constantes (camino de 8 bits)", async () => {
    const r = await runC(`
unsigned char v[5] = { 0, 1, 127, 128, 255 };
signed char s[5] = { -128, -1, 0, 1, 127 };
int a[5], b[5];
int main(void) {
  int i;
  for (i = 0; i < 5; i++) {
    a[i] = (v[i] < 128) + 2 * (v[i] > 1) + 4 * (v[i] == 255) + 8 * (v[i] <= 0) + 16 * (v[i] >= 127);
    b[i] = (s[i] < 0) + 2 * (s[i] > -1) + 4 * (s[i] == -1) + 8 * (s[i] <= -128) + 16 * (s[i] >= 1);
  }
  return 0;
}`);
    // v: 0 -> 1+8 = 9; 1 -> 1; 127 -> 1+2+16 = 19; 128 -> 2+16 = 18; 255 -> 2+4+16 = 22
    expect(Array.from({ length: 5 }, (_, i) => r.s16("a", i))).toEqual([9, 1, 19, 18, 22]);
    // s: -128 -> 1+8 = 9; -1 -> 1+4 = 5; 0 -> 2; 1 -> 2+16 = 18; 127 -> 18
    expect(Array.from({ length: 5 }, (_, i) => r.s16("b", i))).toEqual([9, 5, 2, 18, 18]);
  });

  it("evaluación en cortocircuito de && y || y efectos de ?:", async () => {
    const r = await runC(`
int calls, r[10];
int f(int v) { calls++; return v; }
int main(void) {
  r[0] = f(0) && f(1);  r[1] = calls;   /* 0, 1 */
  r[2] = f(1) || f(0);  r[3] = calls;   /* 1, 2 */
  r[4] = f(1) && f(0);  r[5] = calls;   /* 0, 4 */
  r[6] = f(0) || f(0) || f(7); r[7] = calls; /* 1, 7 */
  r[8] = f(1) ? f(10) : f(20); r[9] = calls; /* 10, 9 */
  return 0;
}`);
    expect(Array.from({ length: 10 }, (_, i) => r.s16("r", i))).toEqual([0, 1, 1, 2, 0, 4, 1, 7, 10, 9]);
  });
});

describe("punteros y arrays", () => {
  it("aritmética de punteros, diferencia, post-incremento y punteros a struct", async () => {
    const r = await runC(`
struct S { char a; int b; };
struct S st[3];
int arr[5] = { 10, 20, 30, 40, 50 };
int r[12];
int main(void) {
  int *p = arr, *q;
  r[0] = *(p + 3);              /* 40 */
  r[1] = p[4];                  /* 50 */
  r[2] = &arr[4] - &arr[1];     /* 3 */
  r[3] = *p++;                  /* 10 */
  r[4] = *p;                    /* 20 */
  q = p + 2; r[5] = q - p;      /* 2 */
  r[6] = &st[2] - &st[0];       /* 2 */
  r[7] = (char *)&st[2] - (char *)&st[0]; /* 2*3 = 6 */
  r[8] = (int)(&arr[3]) - (int)arr;       /* 6 */
  *p++ += 5;                    /* arr[1] = 25 */
  r[9] = arr[1];                /* 25 */
  r[10] = *--p;                 /* 25 */
  r[11] = 3[arr];               /* 40 */
  return 0;
}`);
    expect(Array.from({ length: 12 }, (_, i) => r.s16("r", i))).toEqual([40, 50, 3, 10, 20, 2, 2, 6, 6, 25, 25, 40]);
  });

  it("arrays multidimensionales y punteros a fila", async () => {
    const r = await runC(`
int m[3][4];
int r[6];
int sum(int (*row)[4], int n) { int s = 0, j; for (j = 0; j < n; j++) s += row[0][j]; return s; }
int main(void) {
  int i, j;
  for (i = 0; i < 3; i++) for (j = 0; j < 4; j++) m[i][j] = i * 10 + j;
  r[0] = m[2][3];          /* 23 */
  r[1] = sizeof m;         /* 24 */
  r[2] = sizeof m[0];      /* 8 */
  r[3] = *(*(m + 1) + 2);  /* 12 */
  r[4] = sum(m + 1, 4);    /* 10+11+12+13 = 46 */
  r[5] = &m[2][0] - &m[0][0]; /* 8 */
  return 0;
}`);
    expect(Array.from({ length: 6 }, (_, i) => r.s16("r", i))).toEqual([23, 24, 8, 12, 46, 8]);
  });

  it("array local grande: desplazamientos fuera de IX+d", async () => {
    const r = await runC(`
int r[5];
int main(void) {
  char big[200];
  int x = 1111;
  int i;
  for (i = 0; i < 200; i++) big[i] = i;
  r[0] = big[0] + big[199];   /* 199 */
  r[1] = x;                   /* 1111 */
  x += big[150];              /* 1261 */
  r[2] = x;
  r[3] = sizeof big;          /* 200 */
  { int k = 0; for (i = 0; i < 200; i++) k += big[i]; r[4] = k; } /* 0+..+199 = 19900 */
  return 0;
}`);
    expect(Array.from({ length: 5 }, (_, i) => r.s16("r", i))).toEqual([199, 1111, 1261, 200, 19900]);
  });
});

describe("structs", () => {
  it("copia, paso por puntero, anidados y arrays dentro", async () => {
    const r = await runC(`
struct P { int x, y; };
struct R { struct P a, b; char name[4]; };
struct R g = { { 1, 2 }, { 3, 4 }, "ab" };
int r[10];
void move(struct P *p, int dx) { p->x += dx; p->y -= dx; }
int area(const struct R *q) { return (q->b.x - q->a.x) * (q->b.y - q->a.y); }
int main(void) {
  struct R l;
  struct P t;
  l = g;                         /* copia */
  move(&l.b, 10);                /* b = {13, -6} */
  r[0] = l.b.x; r[1] = l.b.y;    /* 13, -6 */
  r[2] = g.b.x;                  /* 3: g no cambia */
  r[3] = area(&g);               /* (3-1)*(4-2) = 4 */
  r[4] = area(&l);               /* (13-1)*(-6-2) = -96 */
  r[5] = sizeof(struct R);       /* 2*4 + 4 = 12 */
  r[6] = l.name[1];              /* 'b' = 98 */
  t = l.a; t.x = 100;
  r[7] = t.x + l.a.x;            /* 101 */
  r[8] = (&l)->a.y;              /* 2 */
  r[9] = (int)&((struct R *)0)->name; /* offset 8 */
  return 0;
}`);
    expect(Array.from({ length: 10 }, (_, i) => r.s16("r", i))).toEqual([13, -6, 3, 4, -96, 12, 98, 101, 2, 8]);
  });

  it("lista enlazada con punteros a struct", async () => {
    const r = await runC(`
struct N { int v; struct N *next; };
struct N nodes[4];
int r[2];
int main(void) {
  struct N *h = 0, *p;
  int i, s = 0, n = 0;
  for (i = 0; i < 4; i++) { nodes[i].v = (i + 1) * 100; nodes[i].next = h; h = &nodes[i]; }
  for (p = h; p; p = p->next) { s += p->v; n = n * 10 + p->v / 100; }
  r[0] = s; r[1] = n;  /* 1000; orden 4,3,2,1 -> 4321 */
  return 0;
}`);
    expect([r.s16("r", 0), r.s16("r", 1)]).toEqual([1000, 4321]);
  });
});

describe("funciones y recursión", () => {
  it("fib(15) recursivo = 610 y T-states medidos", async () => {
    const r = await runC(`
int fib(int n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); }
int main(void) { return fib(15); }`);
    expect(r.ret).toBe(610);
    // Informativo para el informe (no es una aserción de exactitud).
    console.log(`fib(15): ${r.t} T-states, ${r.bytes} bytes`);
  });

  it("hanoi(3): secuencia de movimientos y hanoi(10) = 1023 movimientos", async () => {
    const r = await runC(`
int moves[8], n, rec = 1;
void hanoi(int k, int from, int to, int via) {
  if (k == 0) return;
  hanoi(k - 1, from, via, to);
  if (rec && n < 8) moves[n] = from * 10 + to;
  n++;
  hanoi(k - 1, via, to, from);
}
int main(void) { int a; hanoi(3, 1, 3, 2); a = n; n = 0; rec = 0; hanoi(10, 1, 3, 2); return a * 10000 + n; }`);
    expect(Array.from({ length: 7 }, (_, i) => r.s16("moves", i))).toEqual([13, 12, 32, 13, 21, 23, 13]);
    expect(r.ret).toBe((7 * 10000 + 1023) & 0xffff);
  });

  it("static locales conservan valor; recursión mutua con prototipo", async () => {
    const r = await runC(`
int r[6];
int counter(void) { static int n = 10; return n++; }
int odd(int n);
int even(int n) { return n == 0 ? 1 : odd(n - 1); }
int odd(int n) { return n == 0 ? 0 : even(n - 1); }
int main(void) {
  r[0] = counter(); r[1] = counter(); r[2] = counter();  /* 10 11 12 */
  r[3] = even(10); r[4] = odd(7); r[5] = even(7);         /* 1 1 0 */
  return 0;
}`);
    expect(Array.from({ length: 6 }, (_, i) => r.s16("r", i))).toEqual([10, 11, 12, 1, 1, 0]);
  });

  it("muchos argumentos (limpieza de pila > 4) y llamadas anidadas", async () => {
    const r = await runC(`
int f6(int a, int b, int c, int d, int e, int f) { return a - b + c * d - e / f; }
int id(int x) { return x; }
int main(void) { return f6(id(100), 30, id(f6(1,1,1,1,1,1)), 7, 50, id(5)); }`);
    // f6(1,1,1,1,1,1) = 1-1+1-1 = 0; 100-30+0*7-50/5 = 60
    expect(r.ret).toBe(60);
  });
});

describe("control de flujo", () => {
  it("switch denso, disperso, con char, fall-through y default", async () => {
    const r = await runC(`
int r[12];
int dense(int x) { switch (x) { case 1: return 10; case 2: return 20; case 3: return 30; case 4: return 40; case 5: return 50; default: return -1; } }
int sparse(int x) { switch (x) { case -1000: return 1; case 7: return 2; case 8: return 3; case 30000: return 4; } return 0; }
int chr(char c) { int n = 0; switch (c) { case 'a': n += 1; case 'b': n += 2; break; case 255: n = 99; break; default: n = -5; } return n; }
int main(void) {
  r[0] = dense(1); r[1] = dense(5); r[2] = dense(0); r[3] = dense(6); r[4] = dense(-32768);
  r[5] = sparse(-1000); r[6] = sparse(8); r[7] = sparse(30000); r[8] = sparse(9);
  r[9] = chr('a'); r[10] = chr('b') * 100 + chr(255); r[11] = chr('z');
  return 0;
}`);
    expect(Array.from({ length: 12 }, (_, i) => r.s16("r", i))).toEqual([10, 50, -1, -1, -1, 1, 3, 4, 0, 3, 299, -5]);
  });

  it("while, do-while, for, break, continue y goto", async () => {
    const r = await runC(`
int r[6];
int main(void) {
  int i = 0, s = 0, j;
  while (i < 10) { i++; if (i % 2) continue; s += i; }     /* 2+4+6+8+10 = 30 */
  r[0] = s;
  i = 0; do { i += 3; } while (i < 10);                    /* 12 */
  r[1] = i;
  s = 0;
  for (i = 0; i < 5; i++) for (j = 0; j < 5; j++) { if (j > i) break; s++; }  /* 1+2+3+4+5 = 15 */
  r[2] = s;
  i = 0;
again:
  i++;
  if (i < 7) goto again;
  r[3] = i;                                                /* 7 */
  for (;;) { if (++i == 20) break; }
  r[4] = i;                                                /* 20 */
  s = 0; for (i = 10; i; i--) s += i;                      /* 55 */
  r[5] = s;
  return 0;
}`);
    expect(Array.from({ length: 6 }, (_, i) => r.s16("r", i))).toEqual([30, 12, 15, 7, 20, 55]);
  });
});

describe("cadenas y datos globales", () => {
  it("literales, escapes, strlen/strcmp a mano y sizeof", async () => {
    const r = await runC(`
int r[10];
int my_strlen(const char *s) { const char *p = s; while (*p) p++; return p - s; }
int my_strcmp(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a - *b; }
char buf[8];
int main(void) {
  const char *s = "Hola\\n";
  char *d = buf;
  const char *src = "copy";
  r[0] = my_strlen(s);               /* 5 */
  r[1] = s[4];                       /* '\\n' = 10 */
  r[2] = "\\x41\\101"[1];            /* 'A' = 65 */
  r[3] = sizeof "a\\0b";             /* 4 */
  r[4] = my_strcmp("abc", "abd") < 0;/* 1 */
  r[5] = my_strcmp("abc", "abc");    /* 0 */
  r[6] = my_strcmp("b", "a") > 0;    /* 1 */
  while ((*d++ = *src++) != 0) ;
  r[7] = my_strlen(buf);             /* 4 */
  r[8] = buf[3];                     /* 'y' = 121 */
  r[9] = "ab" "cd"[3];               /* concatenación: 'd' = 100 */
  return 0;
}`);
    expect(Array.from({ length: 10 }, (_, i) => r.s16("r", i))).toEqual([5, 10, 65, 4, 1, 0, 1, 4, 121, 100]);
  });

  it("globales con inicializador: escalares, arrays, cadenas, punteros, structs y ceros", async () => {
    const r = await runC(`
enum Color { RED, GREEN = 5, BLUE };
typedef struct { int id; char tag; int v[2]; } Item;
int g = 5;
int ga[] = { 1, 2, 3 };
char gs[] = "abc";
int *gp = &ga[2];
const char *names[] = { "ab", "cd" };
Item it = { 7, 'x', { 8, 9 } };
Item its[2] = { 1, 'a', 2, 3, { 4, 'b', { 5, 6 } } };
int z[5] = { 1 };
unsigned char bytes[3] = { 255, 0x80, -1 };
enum Color col = BLUE;
int r[16];
int main(void) {
  r[0] = g; r[1] = sizeof ga; r[2] = sizeof gs; r[3] = *gp; r[4] = names[1][1];
  r[5] = it.id + it.tag + it.v[1];   /* 7 + 120 + 9 = 136 */
  r[6] = its[0].v[1];                 /* 3 (llaves elididas) */
  r[7] = its[1].tag;                  /* 'b' = 98 */
  r[8] = its[1].v[0] + its[1].v[1];   /* 11 */
  r[9] = z[0] + z[4];                 /* 1 */
  r[10] = bytes[0] + bytes[1] + bytes[2]; /* 255+128+255 = 638 */
  r[11] = col;                        /* 6 */
  r[12] = gs[2];                      /* 'c' = 99 */
  r[13] = sizeof(Item);               /* 2+1+4 = 7 */
  r[14] = GREEN * 10 + RED;           /* 50 */
  r[15] = sizeof(its) / sizeof(its[0]); /* 2 */
  return 0;
}`);
    expect(Array.from({ length: 16 }, (_, i) => r.s16("r", i))).toEqual([5, 6, 4, 3, 100, 136, 3, 98, 11, 1, 638, 6, 99, 7, 50, 2]);
  });

  it("inicializadores locales (constantes por LDIR y con variables)", async () => {
    const r = await runC(`
int r[8];
int main(void) {
  int k = 4;
  int a[4] = { 1, 2, 3, 4 };
  char s[] = "xyz";
  int b[5] = { k, k * 2 };
  struct { int x; char c; } p = { -1, 'q' };
  r[0] = a[0] + a[3]; r[1] = s[2]; r[2] = sizeof s; r[3] = b[1]; r[4] = b[4];
  r[5] = p.x; r[6] = p.c; r[7] = a[1] * a[2];
  return 0;
}`);
    expect(Array.from({ length: 8 }, (_, i) => r.s16("r", i))).toEqual([5, 122, 4, 8, 0, -1, 113, 6]);
  });

  it("BSS a cero en cada ejecución aunque la RAM tenga basura", async () => {
    // La RAM se llena de AAh antes de inyectar: la BSS debe valer 0 al entrar en main.
    const src = `int counter; int big[20]; int main(void) { int i, s = 0; for (i = 0; i < 20; i++) s += big[i]; return ++counter * 1000 + s; }`;
    const first = await runC(src, { fill: 0xaa });
    expect(first.ret).toBe(1000);
  });
});

describe("misc", () => {
  it("__asm en línea, sizeof de tipos, casts, coma y nombre de función como valor", async () => {
    const r = await runC(`
int r[8];
void isr(void) {}
int twice(int x) {
  __asm
        ld l,(ix+4)
        ld h,(ix+5)
        add hl,hl
        jp .lret
  __endasm;
  return 0;
}
int main(void) {
  void *pf = isr;
  r[0] = twice(21);                     /* 42 */
  r[1] = sizeof(int) * 100 + sizeof(char) * 10 + sizeof(int *); /* 212 */
  r[2] = (unsigned char)0x1234;         /* 34h = 52 */
  r[3] = (signed char)0x80;             /* -128 */
  r[4] = (r[5] = 3, r[5] + 1);          /* 4 */
  r[6] = pf != 0;                       /* 1 */
  r[7] = (int)pf == (int)&isr;          /* 1 */
  return 0;
}`);
    expect(Array.from({ length: 8 }, (_, i) => r.s16("r", i))).toEqual([42, 212, 52, -128, 4, 3, 1, 1]);
  });

  it("exit() vuelve a BASIC desde una función anidada con H'L' y SP intactos", async () => {
    const r = await runC(`
void exit(int code);
int r[1];
void deep(int n) { if (n == 0) exit(77); deep(n - 1); r[0] = 1; }
int main(void) { deep(5); return 5; }`);
    expect(r.ret).toBe(77);
    expect(r.s16("r", 0)).toBe(0);
    expect(r.probe.regs.get16("sp")).toBe(0xff00);
  });

  it("varios ficheros .c: externos, static con el mismo nombre en dos ficheros", async () => {
    const files = new Map([
      ["main.c", `#include "util.h"\nstatic int hidden = 1;\nint main(void) { return add3(10) + shared + hidden + other_hidden(); }`],
      ["util.h", `#ifndef UTIL_H\n#define UTIL_H\nint add3(int);\nextern int shared;\nint other_hidden(void);\n#endif`],
      ["util.c", `#include "util.h"\nint shared = 100;\nstatic int hidden = 1000;\nint add3(int x) { return x + 3; }\nint other_hidden(void) { return hidden; }`],
    ]);
    const r = await runC(files);
    expect(r.ret).toBe(13 + 100 + 1 + 1000);
  });
});
