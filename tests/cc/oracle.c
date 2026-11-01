/* Oráculo de K1: este fichero se compila con K1 (Z80, int de 16 bits) y con clang
 * (wasm32, tipos de 16 bits forzados). Cada operación convierte su resultado a 16 bits
 * explícitamente, así C da el mismo valor con int de 16 y de 32 bits: las diferencias
 * de promoción no cambian nada y el resultado de clang es un modelo independiente.
 * Sin mezclas con/sin signo en comparaciones (ahí 16 y 32 bits sí difieren). */
#ifdef __K1CC__
typedef int i16;
typedef unsigned u16;
#define EXPORT
#else
typedef short i16;
typedef unsigned short u16;
#define EXPORT __attribute__((export_name("run")))
#endif

#define N 48
u16 out[N * 6];

struct Acc { i16 lo; u16 hi; signed char sc; unsigned char uc; };

static void mix(struct Acc *a, i16 v) {
  a->lo = (i16)(a->lo ^ v);
  a->hi = (u16)((a->hi << 1) | (a->hi >> 15));
  a->hi = (u16)(a->hi + (u16)v);
  a->sc = (signed char)(a->sc + v);
  a->uc = (unsigned char)(a->uc - v);
}

static i16 fib(i16 n) { return n < 2 ? n : (i16)(fib((i16)(n - 1)) + fib((i16)(n - 2))); }

EXPORT u16 *run(void) {
  u16 seed = 12345;
  int k, j;
  struct Acc acc = { 0, 0, 0, 0 };
  u16 *o = out;
  for (k = 0; k < N; k++) {
    i16 a, b, s;
    u16 ua, ub;
    signed char sc;
    unsigned char uc;
    seed = (u16)(seed * 25173u + 13849u);
    a = (i16)seed;
    ub = (u16)((u16)(seed >> 3) | 1u);
    b = (i16)(ub & 0x8000u ? ub | 1u : ub);
    if (k % 7 == 3) b = -1;
    if (k % 11 == 5) a = (i16)0x8000;
    ua = (u16)(seed ^ 0x5a5au);
    s = (i16)(k & 15);
    sc = (signed char)a;
    uc = (unsigned char)b;
    *o++ = (u16)(i16)(a / b);
    *o++ = (u16)(i16)(a % b);
    *o++ = (u16)((u16)(ua / ub) + (u16)(ua % ub) * 3u);
    *o++ = (u16)((u16)(i16)(a >> s) ^ (u16)(ua >> s) ^ (u16)(ua << s));
    *o++ = (u16)((u16)(i16)(a * b) + (u16)(i16)(sc * uc) + (u16)(a < b) * 7u + (u16)(ua < ub) * 11u + (u16)(sc < -5) * 13u + (u16)(uc > 200) * 17u);
    mix(&acc, a);
    *o++ = (u16)(acc.lo + acc.hi + acc.sc + acc.uc);
  }
  /* Ordenación por inserción de la mitad con signo y Fibonacci recursivo. */
  for (k = 1; k < N; k++) {
    i16 v = (i16)out[k];
    for (j = k - 1; j >= 0 && (i16)out[j] > v; j--) out[j + 1] = out[j];
    out[j + 1] = (u16)v;
  }
  out[N * 6 - 1] = (u16)fib(18);
  return out;
}

#ifdef __K1CC__
int main(void) { run(); return 0; }
#endif
