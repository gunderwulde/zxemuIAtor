/*
 * snap.c — snapshots SNA y Z80 v1–v3 (sólo 48K) (docs/zx48-hardware.md §11).
 *
 * Formatos según la documentación de World of Spectrum ("Z80 file format", "SNA") y
 * libspectrum (sna.c, z80.c), que es lo que usa Fuse.
 *
 * Al cargar no se toca zx.t (posición en el frame): SNA no la guarda y la de Z80 v3
 * se ignora; mover el reloj a mitad de frame descuadraría el render perezoso.
 */
#include "machine.h"

#define SNA_HEADER 27
#define SNA_LEN    (SNA_HEADER + 49152)

static inline uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | p[1] << 8); }

static inline void wr16(uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)v;
    p[1] = (uint8_t)(v >> 8);
}

/* Estado interno que ningún formato guarda: a reposo. */
static void cpu_clean(ZxRegs *r)
{
    r->memptr.w = 0;
    r->halted = 0;
    r->q = 0;
    r->ei_delay = 0;
    r->ld_air = 0;
}

static void set_border(uint8_t b)
{
    video_catch_up(zx.t);
    audio_out(zx.t, b & 7);
    zx.last_fe = b & 7;
}

/* Copia RAM al mapa: la pantalla cambia entera, así que el vídeo se pone al día antes. */
static void put_ram(uint16_t addr, const uint8_t *src, uint32_t n)
{
    video_catch_up(zx.t);
    zx_memcpy(zx.mem + addr, src, n);
}

/* ---- SNA ---- */

int zx_load_sna(uint32_t len)
{
    if (len != SNA_LEN)
        return ZX_ERR_SIZE;
    const uint8_t *h = zx_io;
    ZxRegs *r = &zx.cpu;
    if (h[25] > 2)
        return ZX_ERR_FORMAT;

    r->i = h[0];
    r->hl_.w = rd16(h + 1);
    r->de_.w = rd16(h + 3);
    r->bc_.w = rd16(h + 5);
    r->af_.w = rd16(h + 7);
    r->hl.w = rd16(h + 9);
    r->de.w = rd16(h + 11);
    r->bc.w = rd16(h + 13);
    r->iy.w = rd16(h + 15);
    r->ix.w = rd16(h + 17);
    r->iff1 = r->iff2 = (h[19] >> 2) & 1;
    r->r = h[20];
    r->af.w = rd16(h + 21);
    r->sp.w = rd16(h + 23);
    r->im = h[25];
    cpu_clean(r);
    put_ram(0x4000, h + SNA_HEADER, 49152);
    set_border(h[26]);

    /* El PC está en la pila (RETN del NMI con que se tomó): POP PC. */
    zx_set_pc((uint16_t)(zx.mem[r->sp.w] | zx.mem[(uint16_t)(r->sp.w + 1)] << 8));
    r->sp.w += 2;
    return ZX_OK;
}

uint32_t zx_save_sna(void)
{
    uint8_t *h = zx_io;
    const ZxRegs *r = &zx.cpu;

    h[0] = r->i;
    wr16(h + 1, r->hl_.w);
    wr16(h + 3, r->de_.w);
    wr16(h + 5, r->bc_.w);
    wr16(h + 7, r->af_.w);
    wr16(h + 9, r->hl.w);
    wr16(h + 11, r->de.w);
    wr16(h + 13, r->bc.w);
    wr16(h + 15, r->iy.w);
    wr16(h + 17, r->ix.w);
    h[19] = r->iff2 ? 0x04 : 0x00;
    h[20] = r->r;
    wr16(h + 21, r->af.w);
    h[25] = r->im;
    h[26] = zx.last_fe & 7;
    zx_memcpy(h + SNA_HEADER, zx.mem + 0x4000, 49152);

    /* PUSH PC sobre la copia, no sobre la máquina: guardar no cambia el estado. Si la
     * pila cae en ROM esos bytes se pierden (limitación del formato). */
    uint16_t sp = (uint16_t)(r->sp.w - 2);
    for (int i = 0; i < 2; i++) {
        uint16_t a = (uint16_t)(sp + i);
        if (a >= 0x4000)
            h[SNA_HEADER + a - 0x4000] = (uint8_t)(r->pc.w >> (8 * i));
    }
    wr16(h + 23, sp);
    return SNA_LEN;
}

/* ---- Z80 ---- */

/* Descompresión "ED ED nn bb" = nn copias de bb; el resto, literal. Devuelve los bytes
 * de entrada consumidos, o 0 si la entrada se acaba o una racha se sale de 'want'. */
static uint32_t z80_unpack(const uint8_t *src, uint32_t avail, uint8_t *dst, uint32_t want)
{
    uint32_t i = 0, o = 0;
    while (o < want) {
        if (i >= avail)
            return 0;
        if (src[i] == 0xED && i + 1 < avail && src[i + 1] == 0xED) {
            if (i + 3 >= avail)
                return 0;
            uint32_t n = src[i + 2];
            if (n > want - o)
                return 0;
            zx_memset(dst + o, src[i + 3], n);
            o += n;
            i += 4;
        } else {
            dst[o++] = src[i++];
        }
    }
    return i;
}

static uint8_t z80_ram[49152];   /* se descomprime aquí y sólo se aplica si todo es válido */

int zx_load_z80(uint32_t len)
{
    const uint8_t *h = zx_io;
    /* El fichero sólo puede estar en zx_io: un len mayor haría leer fuera. */
    if (len < 30 || len > ZX_IO_BUFFER_SIZE)
        return ZX_ERR_SIZE;

    if ((h[29] & 3) == 3)
        return ZX_ERR_FORMAT;   /* no existe IM 3 */
    uint16_t pc = rd16(h + 6);
    uint8_t b12 = h[12] == 0xFF ? 1 : h[12];   /* compatibilidad: 255 cuenta como 1 */

    if (pc) {
        /* v1: siempre 48K. */
        const uint8_t *src = h + 30;
        uint32_t avail = len - 30;
        if (b12 & 0x20) {
            uint32_t used = z80_unpack(src, avail, z80_ram, 49152);
            if (!used)
                return ZX_ERR_FORMAT;
            /* Tras los datos puede ir el marcador 00 ED ED 00 (WoS "Z80 file format": "the
             * block is terminated by an end marker, 0x00 0xED 0xED 0x00"); nada más. */
            const uint8_t *m = src + used;
            uint32_t rest = avail - used;
            if (rest != 0 && !(rest == 4 && m[0] == 0x00 && m[1] == 0xED && m[2] == 0xED && m[3] == 0x00))
                return ZX_ERR_FORMAT;
        } else {
            if (avail != 49152)
                return ZX_ERR_SIZE;
            zx_memcpy(z80_ram, src, 49152);
        }
    } else {
        if (len < 32)
            return ZX_ERR_SIZE;
        uint32_t ext = rd16(h + 30);
        int v3;
        if (ext == 23)
            v3 = 0;
        else if (ext == 54 || ext == 55)
            v3 = 1;
        else
            return ZX_ERR_FORMAT;
        if (len < 32 + ext)
            return ZX_ERR_SIZE;
        pc = rd16(h + 32);
        uint8_t hw = h[34];
        /* 48K: v2 0 (48K) y 1 (+IF1); v3 0, 1 y 3 (+MGT). El bit 7 del byte 37 con
         * un modelo 48K significa 16K. */
        int is48 = hw == 0 || hw == 1 || (v3 && hw == 3);
        if (!is48 || (h[37] & 0x80))
            return ZX_ERR_MODEL;

        uint32_t seen = 0;
        uint32_t off = 32 + ext;
        while (off < len) {
            if (len - off < 3)
                return ZX_ERR_FORMAT;
            uint32_t blen = rd16(h + off);
            uint8_t page = h[off + 2];
            off += 3;
            uint32_t n = blen == 0xFFFF ? 16384 : blen;
            if (n > len - off)
                return ZX_ERR_SIZE;
            int dst = page == 8 ? 0 : page == 4 ? 1 : page == 5 ? 2 : -1;
            if (dst >= 0) {
                if (seen & (1u << dst))
                    return ZX_ERR_FORMAT;
                seen |= 1u << dst;
                /* Una página comprimida se expande a 16384 bytes exactos consumiendo
                 * el bloque entero. z80_unpack devuelve 0 si no llega a 16384, así que
                 * un bloque vacío (n = 0) pasaría por "consumido entero": se rechaza. */
                uint8_t *d = z80_ram + dst * 16384;
                if (blen == 0xFFFF)
                    zx_memcpy(d, h + off, 16384);
                else if (n == 0 || z80_unpack(h + off, n, d, 16384) != n)
                    return ZX_ERR_FORMAT;
            }
            /* Otras páginas (ROM, IF1, MGT) no existen en esta máquina: se ignoran. */
            off += n;
        }
        if (seen != 7)
            return ZX_ERR_FORMAT;
    }

    ZxRegs *r = &zx.cpu;
    r->af.b.h = h[0];
    r->af.b.l = h[1];
    r->bc.w = rd16(h + 2);
    r->hl.w = rd16(h + 4);
    zx_set_pc(pc);
    r->sp.w = rd16(h + 8);
    r->i = h[10];
    r->r = (uint8_t)((h[11] & 0x7F) | (b12 & 1) << 7);
    r->de.w = rd16(h + 13);
    r->bc_.w = rd16(h + 15);
    r->de_.w = rd16(h + 17);
    r->hl_.w = rd16(h + 19);
    r->af_.b.h = h[21];
    r->af_.b.l = h[22];
    r->iy.w = rd16(h + 23);
    r->ix.w = rd16(h + 25);
    r->iff1 = h[27] != 0;
    r->iff2 = h[28] != 0;
    r->im = h[29] & 3;
    cpu_clean(r);
    /* Bit 2 del byte 29: emulación Issue 2 (Fuse la aplica al cargar). */
    zx.issue = (h[29] & 0x04) ? 2 : 3;
    put_ram(0x4000, z80_ram, 49152);
    set_border((uint8_t)((b12 >> 1) & 7));
    return ZX_OK;
}
