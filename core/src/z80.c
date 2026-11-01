/*
 * z80.c — CPU Z80 (NMOS, Zilog). Se incluye desde la máquina (zx48.c / testbus.c)
 * DESPUÉS de definir las funciones bus_* de bus.h (unity build). No compilar suelto.
 *
 * Cada instrucción escribe sus ciclos de bus en el orden real, con la misma
 * descomposición que Fuse (z80/opcodes_base.c, z80_ddfd.c, z80_ed.c, z80_macros.h):
 *   bus_read(pc, 4)     M1 (fetch + refresco)
 *   bus_read(a, 3)      lectura de memoria
 *   bus_write(a, v, 3)  escritura de memoria
 *   bus_contend(a, 1)   T interno con `a` en el bus (contendido uno a uno)
 *   bus_tick(n)         T sin dirección (sólo aceptación de INT/NMI)
 *   bus_in / bus_out    ciclo de E/S de 4 T
 * El patrón se compara 1:1 con los eventos de tests/fixtures/fuse/tests.expected.
 *
 * Comportamiento no documentado (docs/zx48-hardware.md §9): XF/YF, MEMPTR (WZ), Q,
 * SLL, IXH/IXL, DDCB con registro, OUT (C),0, IN F,(C), ED inválidos, y flags de
 * las iteraciones que repiten de LDxR/CPxR/INxR/OTxR (David Banks / Patrik Rak, 2018).
 */

#define FC 0x01
#define FN 0x02
#define FP 0x04   /* P/V */
#define F3 0x08   /* XF */
#define FH 0x10
#define F5 0x20   /* YF */
#define FZ 0x40
#define FS 0x80

/* ---- Tablas de flags (constantes de compilación, sin inicialización en runtime) ----
 * 0x9669: bit n a 1 si el nibble n tiene paridad par. Plegar el byte en un nibble
 * conserva la paridad. */
#define Z80_PAR(x)   ((((0x9669 >> (((x) ^ ((x) >> 4)) & 0x0F)) & 1)) << 2)
#define Z80_SZ53(x)  (((x) & 0xA8) | ((x) == 0 ? FZ : 0))
#define Z80_SZ53P(x) (Z80_SZ53(x) | Z80_PAR(x))
#define Z80_T4(f, n)  f(n), f((n) + 1), f((n) + 2), f((n) + 3)
#define Z80_T16(f, n) Z80_T4(f, n), Z80_T4(f, (n) + 4), Z80_T4(f, (n) + 8), Z80_T4(f, (n) + 12)
#define Z80_T64(f, n) Z80_T16(f, n), Z80_T16(f, (n) + 16), Z80_T16(f, (n) + 32), Z80_T16(f, (n) + 48)
#define Z80_T256(f)   Z80_T64(f, 0), Z80_T64(f, 64), Z80_T64(f, 128), Z80_T64(f, 192)

static const uint8_t par_table[256]   = { Z80_T256(Z80_PAR) };    /* FP o 0 */
static const uint8_t sz53_table[256]  = { Z80_T256(Z80_SZ53) };   /* S, Z, YF, XF */
static const uint8_t sz53p_table[256] = { Z80_T256(Z80_SZ53P) };  /* S, Z, YF, XF, P */

/* ---- Acceso a registros ---- */
#define A   r->af.b.h
#define F   r->af.b.l
#define B   r->bc.b.h
#define C   r->bc.b.l
#define D   r->de.b.h
#define E   r->de.b.l
#define H   r->hl.b.h
#define L   r->hl.b.l
#define AF  r->af.w
#define BC  r->bc.w
#define DE  r->de.w
#define HL  r->hl.w
#define SP  r->sp.w
#define PC  r->pc.w
#define WZ  r->memptr.w
#define IR  ((uint16_t)((r->i << 8) | r->r))

/* Toda instrucción que calcula flags pasa por aquí: Q (docs §9) es F si la instrucción
 * los modificó y 0 si no. POP AF y EX AF,AF' cargan F sin pasar por la ALU y dejan
 * Q = 0: SingleStepTests f1 y 08, final.q = 0 en los 1000 casos de cada uno (la mitad
 * empiezan con q != 0). */
#define SETF(v) (r->q = F = (uint8_t)(v))

#define CC_NZ (!(F & FZ))
#define CC_Z  (F & FZ)
#define CC_NC (!(F & FC))
#define CC_C  (F & FC)
#define CC_PO (!(F & FP))
#define CC_PE (F & FP)
#define CC_P  (!(F & FS))
#define CC_M  (F & FS)

/* El refresco incrementa los 7 bits bajos de R en cada M1; el bit 7 sólo lo cambia
 * LD R,A. */
static inline void z80_inc_r(ZxRegs *r)
{
    r->r = (uint8_t)((r->r & 0x80) | ((r->r + 1) & 0x7F));
}

static inline uint8_t z80_fetch(ZxRegs *r)
{
    uint8_t op = bus_read(PC, 4);
    PC++;
    z80_inc_r(r);
    return op;
}

static inline uint8_t z80_imm8(ZxRegs *r)
{
    uint8_t v = bus_read(PC, 3);
    PC++;
    return v;
}

static inline uint16_t z80_imm16(ZxRegs *r)
{
    uint8_t lo = bus_read(PC, 3);
    PC++;
    uint8_t hi = bus_read(PC, 3);
    PC++;
    return (uint16_t)(lo | (hi << 8));
}

/* PUSH: SP baja antes de cada escritura; primero el byte alto. */
static inline void z80_push(ZxRegs *r, uint16_t v)
{
    SP--;
    bus_write(SP, (uint8_t)(v >> 8), 3);
    SP--;
    bus_write(SP, (uint8_t)v, 3);
}

static inline uint16_t z80_pop(ZxRegs *r)
{
    uint8_t lo = bus_read(SP, 3);
    SP++;
    uint8_t hi = bus_read(SP, 3);
    SP++;
    return (uint16_t)(lo | (hi << 8));
}

/* Ciclos internos con IR en el bus (M1 de 5/6 T, ADD HL,rr…): la ULA ve IR y
 * contiende cada T por separado. */
static inline void z80_ir_cycles(ZxRegs *r, int n)
{
    for (int i = 0; i < n; i++)
        bus_contend(IR, 1);
}

static inline void z80_addr_cycles(uint16_t a, int n)
{
    for (int i = 0; i < n; i++)
        bus_contend(a, 1);
}

/* JR/DJNZ tomado: lectura del desplazamiento y 5 T internos con la dirección del
 * desplazamiento aún en el bus. */
static inline void z80_jr(ZxRegs *r)
{
    int8_t d = (int8_t)bus_read(PC, 3);
    z80_addr_cycles(PC, 5);
    PC = (uint16_t)(PC + 1 + d);
    WZ = PC;
}

/* JR no tomado: el ciclo de lectura del desplazamiento existe (y se contiende) pero
 * Fuse no lo registra como lectura: un único MC de 3 T. */
static inline void z80_jr_skip(ZxRegs *r)
{
    bus_contend(PC, 3);
    PC++;
}

static inline void z80_call(ZxRegs *r, int cond)
{
    uint8_t lo = bus_read(PC, 3);
    PC++;
    uint8_t hi = bus_read(PC, 3);
    WZ = (uint16_t)(lo | (hi << 8));
    if (cond) {
        bus_contend(PC, 1);   /* T extra del tercer ciclo antes de apilar */
        PC++;
        z80_push(r, PC);
        PC = WZ;
    } else {
        PC++;
    }
}

static inline void z80_ret_cc(ZxRegs *r, int cond)
{
    bus_contend(IR, 1);
    if (cond) {
        PC = z80_pop(r);
        WZ = PC;
    }
}

static inline void z80_rst(ZxRegs *r, uint16_t addr)
{
    bus_contend(IR, 1);
    z80_push(r, PC);
    PC = addr;
    WZ = PC;
}

/* ---- ALU de 8 bits ---- */

static inline void z80_add8(ZxRegs *r, uint8_t v, unsigned carry)
{
    unsigned a = A, res = a + v + carry;
    SETF(sz53_table[res & 0xFF] | ((res >> 8) & FC) | ((a ^ v ^ res) & FH)
         | (((a ^ ~(unsigned)v) & (a ^ res) & 0x80) >> 5));
    A = (uint8_t)res;
}

static inline void z80_sub8(ZxRegs *r, uint8_t v, unsigned carry)
{
    unsigned a = A, res = a - v - carry;
    SETF(sz53_table[res & 0xFF] | ((res >> 8) & FC) | FN | ((a ^ v ^ res) & FH)
         | (((a ^ v) & (a ^ res) & 0x80) >> 5));
    A = (uint8_t)res;
}

/* CP: como SUB sin guardar, pero XF/YF salen del operando. */
static inline void z80_cp8(ZxRegs *r, uint8_t v)
{
    unsigned a = A, res = a - v;
    SETF((sz53_table[res & 0xFF] & (FS | FZ)) | (v & (F3 | F5)) | ((res >> 8) & FC) | FN
         | ((a ^ v ^ res) & FH) | (((a ^ v) & (a ^ res) & 0x80) >> 5));
}

/* Grupo ALU por los bits 5..3 del opcode, como lo decodifica el propio Z80. */
static inline void z80_alu(ZxRegs *r, unsigned op, uint8_t v)
{
    switch ((op >> 3) & 7) {
    case 0: z80_add8(r, v, 0); break;
    case 1: z80_add8(r, v, F & FC); break;
    case 2: z80_sub8(r, v, 0); break;
    case 3: z80_sub8(r, v, F & FC); break;
    case 4: A &= v; SETF(sz53p_table[A] | FH); break;
    case 5: A ^= v; SETF(sz53p_table[A]); break;
    case 6: A |= v; SETF(sz53p_table[A]); break;
    default: z80_cp8(r, v); break;
    }
}

static inline uint8_t z80_inc8(ZxRegs *r, uint8_t v)
{
    v++;
    SETF((F & FC) | sz53_table[v] | ((v & 0x0F) ? 0 : FH) | (v == 0x80 ? FP : 0));
    return v;
}

static inline uint8_t z80_dec8(ZxRegs *r, uint8_t v)
{
    SETF((F & FC) | FN | ((v & 0x0F) ? 0 : FH) | (v == 0x80 ? FP : 0));
    v--;
    SETF(F | sz53_table[v]);
    return v;
}

/* ---- ALU de 16 bits ---- */

static inline uint16_t z80_add16(ZxRegs *r, uint16_t a, uint16_t v)
{
    unsigned res = (unsigned)a + v;
    WZ = (uint16_t)(a + 1);
    SETF((F & (FS | FZ | FP)) | ((res >> 16) & FC) | ((res >> 8) & (F3 | F5))
         | (((a ^ v ^ res) >> 8) & FH));
    return (uint16_t)res;
}

static inline void z80_adc16(ZxRegs *r, uint16_t v)
{
    unsigned a = HL, res = a + v + (F & FC);
    WZ = (uint16_t)(a + 1);
    SETF(((res >> 16) & FC) | (((a ^ ~(unsigned)v) & (a ^ res) & 0x8000) >> 13)
         | (((a ^ v ^ res) >> 8) & FH) | ((res >> 8) & (FS | F3 | F5))
         | ((res & 0xFFFF) ? 0 : FZ));
    HL = (uint16_t)res;
}

static inline void z80_sbc16(ZxRegs *r, uint16_t v)
{
    unsigned a = HL, res = a - v - (F & FC);
    WZ = (uint16_t)(a + 1);
    SETF(FN | ((res >> 16) & FC) | (((a ^ v) & (a ^ res) & 0x8000) >> 13)
         | (((a ^ v ^ res) >> 8) & FH) | ((res >> 8) & (FS | F3 | F5))
         | ((res & 0xFFFF) ? 0 : FZ));
    HL = (uint16_t)res;
}

/* ---- Prefijo CB ---- */

static inline uint8_t z80_reg8_get(ZxRegs *r, unsigned i)
{
    switch (i) {
    case 0: return B;
    case 1: return C;
    case 2: return D;
    case 3: return E;
    case 4: return H;
    case 5: return L;
    default: return A;   /* 7; el 6 es (HL) y no llega aquí */
    }
}

static inline void z80_reg8_set(ZxRegs *r, unsigned i, uint8_t v)
{
    switch (i) {
    case 0: B = v; break;
    case 1: C = v; break;
    case 2: D = v; break;
    case 3: E = v; break;
    case 4: H = v; break;
    case 5: L = v; break;
    default: A = v; break;
    }
}

/* Rotaciones/desplazamientos (00–3F), RES (80–BF) y SET (C0–FF). */
static inline uint8_t z80_cb_op(ZxRegs *r, unsigned op, uint8_t v)
{
    unsigned c;
    switch (op >> 6) {
    case 0:
        switch ((op >> 3) & 7) {
        case 0: c = v >> 7; v = (uint8_t)((v << 1) | c); break;             /* RLC */
        case 1: c = v & 1; v = (uint8_t)((v >> 1) | (c << 7)); break;        /* RRC */
        case 2: c = v >> 7; v = (uint8_t)((v << 1) | (F & FC)); break;       /* RL  */
        case 3: c = v & 1; v = (uint8_t)((v >> 1) | (F << 7)); break;        /* RR  */
        case 4: c = v >> 7; v = (uint8_t)(v << 1); break;                    /* SLA */
        case 5: c = v & 1; v = (uint8_t)((v & 0x80) | (v >> 1)); break;      /* SRA */
        case 6: c = v >> 7; v = (uint8_t)((v << 1) | 1); break;              /* SLL (no doc.) */
        default: c = v & 1; v = (uint8_t)(v >> 1); break;                    /* SRL */
        }
        SETF(c | sz53p_table[v]);
        return v;
    case 2:
        return (uint8_t)(v & ~(1u << ((op >> 3) & 7)));
    default:
        return (uint8_t)(v | (1u << ((op >> 3) & 7)));
    }
}

/* BIT: S/Z/P del bit probado; XF/YF de `x35`, que según la forma es el registro,
 * MEMPTR alto (BIT n,(HL)) o el byte alto de IX+d. */
static inline void z80_bit(ZxRegs *r, unsigned op, uint8_t v, uint8_t x35)
{
    unsigned m = v & (1u << ((op >> 3) & 7));
    SETF((F & FC) | FH | (x35 & (F3 | F5)) | (m ? (m & FS) : (FZ | FP)));
}

static inline void z80_cb(ZxRegs *r)
{
    unsigned op = z80_fetch(r);
    unsigned i = op & 7;
    if (i == 6) {
        uint8_t v = bus_read(HL, 3);
        bus_contend(HL, 1);
        if ((op & 0xC0) == 0x40) {
            z80_bit(r, op, v, (uint8_t)(WZ >> 8));
            return;
        }
        bus_write(HL, z80_cb_op(r, op, v), 3);
        return;
    }
    uint8_t v = z80_reg8_get(r, i);
    if ((op & 0xC0) == 0x40)
        z80_bit(r, op, v, v);
    else
        z80_reg8_set(r, i, z80_cb_op(r, op, v));
}

/* DDCB/FDCB d op: el desplazamiento y el opcode se leen como datos (no son M1, R no
 * avanza); 2 T internos con el opcode en el bus. Las formas con registro distinto de
 * (HL) escriben el resultado también en ese registro (H/L reales, no IXH/IXL). */
static inline void z80_xycb(ZxRegs *r, uint16_t base)
{
    int8_t d = (int8_t)bus_read(PC, 3);
    PC++;
    uint16_t a = (uint16_t)(base + d);
    WZ = a;
    unsigned op = bus_read(PC, 3);
    bus_contend(PC, 1);
    bus_contend(PC, 1);
    PC++;
    uint8_t v = bus_read(a, 3);
    bus_contend(a, 1);
    if ((op & 0xC0) == 0x40) {
        z80_bit(r, op, v, (uint8_t)(a >> 8));
        return;
    }
    v = z80_cb_op(r, op, v);
    bus_write(a, v, 3);
    if ((op & 7) != 6)
        z80_reg8_set(r, op & 7, v);
}

/* ---- Prefijo ED ---- */

static inline uint8_t z80_in_c(ZxRegs *r)
{
    uint8_t v = bus_in(BC);
    WZ = (uint16_t)(BC + 1);
    SETF((F & FC) | sz53p_table[v]);
    return v;
}

static inline void z80_out_c(ZxRegs *r, uint8_t v)
{
    bus_out(BC, v);
    WZ = (uint16_t)(BC + 1);
}

static inline void z80_neg(ZxRegs *r)
{
    uint8_t v = A;
    A = 0;
    z80_sub8(r, v, 0);
}

static inline void z80_ld_nn_rr(ZxRegs *r, uint16_t v)
{
    uint16_t a = z80_imm16(r);
    bus_write(a, (uint8_t)v, 3);
    a++;
    WZ = a;
    bus_write(a, (uint8_t)(v >> 8), 3);
}

static inline uint16_t z80_ld_rr_nn(ZxRegs *r)
{
    uint16_t a = z80_imm16(r);
    uint8_t lo = bus_read(a, 3);
    a++;
    WZ = a;
    uint8_t hi = bus_read(a, 3);
    return (uint16_t)(lo | (hi << 8));
}

/* LDI/LDD/LDIR/LDDR. XF = bit 3 y YF = bit 1 de (A + byte). En la iteración que
 * repite, XF/YF salen de los bits 11 y 13 del PC ya retrocedido (Banks 2018). */
static inline void z80_ldx(ZxRegs *r, int dir, int rep)
{
    uint8_t v = bus_read(HL, 3);
    bus_write(DE, v, 3);
    bus_contend(DE, 1);
    bus_contend(DE, 1);
    BC--;
    unsigned n = (unsigned)v + A;
    SETF((F & (FS | FZ | FC)) | (BC ? FP : 0) | (n & F3) | ((n << 4) & F5));
    if (rep && BC) {
        z80_addr_cycles(DE, 5);
        PC -= 2;
        WZ = (uint16_t)(PC + 1);
        SETF((F & ~(F3 | F5)) | ((PC >> 8) & (F3 | F5)));
    }
    HL = (uint16_t)(HL + dir);
    DE = (uint16_t)(DE + dir);
}

/* CPI/CPD/CPIR/CPDR. XF/YF de (A − byte − HF) con la misma regla de bits 3 y 1. */
static inline void z80_cpx(ZxRegs *r, int dir, int rep)
{
    uint8_t v = bus_read(HL, 3);
    z80_addr_cycles(HL, 5);
    uint8_t res = (uint8_t)(A - v);
    BC--;
    unsigned h = (A ^ v ^ res) & FH;
    unsigned n = (unsigned)res - (h >> 4);
    SETF((F & FC) | FN | (sz53_table[res] & (FS | FZ)) | h | (BC ? FP : 0)
         | (n & F3) | ((n << 4) & F5));
    if (rep && BC && res) {
        z80_addr_cycles(HL, 5);
        PC -= 2;
        WZ = (uint16_t)(PC + 1);
        SETF((F & ~(F3 | F5)) | ((PC >> 8) & (F3 | F5)));
    } else {
        WZ = (uint16_t)(WZ + dir);
    }
    HL = (uint16_t)(HL + dir);
}

/* Flags de INxR/OTxR en la iteración que repite (Banks/Rak 2018, mismo modelo que
 * MAME): XF/YF del PC alto, y HF/PF recalculados según el acarreo y el bit 7 del dato,
 * porque el Z80 vuelve a pasar B por la ALU mientras repite. */
static inline void z80_io_repeat_flags(ZxRegs *r, uint8_t v)
{
    unsigned f = (F & ~(F3 | F5)) | ((PC >> 8) & (F3 | F5));
    if (f & FC) {
        f &= ~FH;
        if (v & 0x80) {
            f ^= par_table[(B - 1) & 7] ^ FP;
            if ((B & 0x0F) == 0x00) f |= FH;
        } else {
            f ^= par_table[(B + 1) & 7] ^ FP;
            if ((B & 0x0F) == 0x0F) f |= FH;
        }
    } else {
        f ^= par_table[B & 7] ^ FP;
    }
    SETF(f);
}

/* INI/IND/INIR/INDR. MEMPTR = BC ± 1 con el B anterior al decremento. */
static inline void z80_inx(ZxRegs *r, int dir, int rep)
{
    bus_contend(IR, 1);
    uint8_t v = bus_in(BC);
    bus_write(HL, v, 3);
    WZ = (uint16_t)(BC + dir);
    B--;
    unsigned k = (unsigned)v + (uint8_t)(C + dir);
    SETF((v & 0x80 ? FN : 0) | (k > 0xFF ? (FH | FC) : 0) | par_table[(k & 7) ^ B] | sz53_table[B]);
    if (rep && B) {
        z80_addr_cycles(HL, 5);
        PC -= 2;
        WZ = (uint16_t)(PC + 1);   /* como LDxR/CPxR al repetir (SingleStepTests ED B2/BA) */
        z80_io_repeat_flags(r, v);
    }
    HL = (uint16_t)(HL + dir);
}

/* OUTI/OUTD/OTIR/OTDR. B se decrementa ANTES de poner BC en el bus de E/S. */
static inline void z80_outx(ZxRegs *r, int dir, int rep)
{
    bus_contend(IR, 1);
    uint8_t v = bus_read(HL, 3);
    B--;
    WZ = (uint16_t)(BC + dir);
    bus_out(BC, v);
    HL = (uint16_t)(HL + dir);
    unsigned k = (unsigned)v + L;
    SETF((v & 0x80 ? FN : 0) | (k > 0xFF ? (FH | FC) : 0) | par_table[(k & 7) ^ B] | sz53_table[B]);
    if (rep && B) {
        z80_addr_cycles(BC, 5);
        PC -= 2;
        WZ = (uint16_t)(PC + 1);   /* como LDxR/CPxR al repetir (SingleStepTests ED B3/BB) */
        z80_io_repeat_flags(r, v);
    }
}

static inline void z80_ed(ZxRegs *r)
{
    unsigned op = z80_fetch(r);
    switch (op) {
    case 0x40: B = z80_in_c(r); break;
    case 0x48: C = z80_in_c(r); break;
    case 0x50: D = z80_in_c(r); break;
    case 0x58: E = z80_in_c(r); break;
    case 0x60: H = z80_in_c(r); break;
    case 0x68: L = z80_in_c(r); break;
    case 0x70: (void)z80_in_c(r); break;            /* IN F,(C): sólo flags */
    case 0x78: A = z80_in_c(r); break;

    case 0x41: z80_out_c(r, B); break;
    case 0x49: z80_out_c(r, C); break;
    case 0x51: z80_out_c(r, D); break;
    case 0x59: z80_out_c(r, E); break;
    case 0x61: z80_out_c(r, H); break;
    case 0x69: z80_out_c(r, L); break;
    case 0x71: z80_out_c(r, 0); break;              /* OUT (C),0: 0 en NMOS */
    case 0x79: z80_out_c(r, A); break;

    case 0x42: z80_ir_cycles(r, 7); z80_sbc16(r, BC); break;
    case 0x52: z80_ir_cycles(r, 7); z80_sbc16(r, DE); break;
    case 0x62: z80_ir_cycles(r, 7); z80_sbc16(r, HL); break;
    case 0x72: z80_ir_cycles(r, 7); z80_sbc16(r, SP); break;
    case 0x4A: z80_ir_cycles(r, 7); z80_adc16(r, BC); break;
    case 0x5A: z80_ir_cycles(r, 7); z80_adc16(r, DE); break;
    case 0x6A: z80_ir_cycles(r, 7); z80_adc16(r, HL); break;
    case 0x7A: z80_ir_cycles(r, 7); z80_adc16(r, SP); break;

    case 0x43: z80_ld_nn_rr(r, BC); break;
    case 0x53: z80_ld_nn_rr(r, DE); break;
    case 0x63: z80_ld_nn_rr(r, HL); break;
    case 0x73: z80_ld_nn_rr(r, SP); break;
    case 0x4B: BC = z80_ld_rr_nn(r); break;
    case 0x5B: DE = z80_ld_rr_nn(r); break;
    case 0x6B: HL = z80_ld_rr_nn(r); break;
    case 0x7B: SP = z80_ld_rr_nn(r); break;

    case 0x44: case 0x4C: case 0x54: case 0x5C:
    case 0x64: case 0x6C: case 0x74: case 0x7C:
        z80_neg(r);
        break;

    /* RETN y RETI (y sus duplicados) copian IFF2 en IFF1. */
    case 0x45: case 0x4D: case 0x55: case 0x5D:
    case 0x65: case 0x6D: case 0x75: case 0x7D:
        r->iff1 = r->iff2;
        PC = z80_pop(r);
        WZ = PC;
        break;

    case 0x46: case 0x4E: case 0x66: case 0x6E: r->im = 0; break;
    case 0x56: case 0x76: r->im = 1; break;
    case 0x5E: case 0x7E: r->im = 2; break;

    case 0x47: bus_contend(IR, 1); r->i = A; break;
    case 0x4F: bus_contend(IR, 1); r->r = A; break;
    /* LD A,I / LD A,R: P/V = IFF2; si justo después se acepta una INT, el NMOS deja
     * P/V a 0 (ld_air, lo aplica la aceptación). */
    case 0x57:
        bus_contend(IR, 1);
        A = r->i;
        SETF((F & FC) | sz53_table[A] | (r->iff2 ? FP : 0));
        r->ld_air = 1;
        break;
    case 0x5F:
        bus_contend(IR, 1);
        A = r->r;
        SETF((F & FC) | sz53_table[A] | (r->iff2 ? FP : 0));
        r->ld_air = 1;
        break;

    case 0x67: {   /* RRD */
        uint8_t v = bus_read(HL, 3);
        z80_addr_cycles(HL, 4);
        bus_write(HL, (uint8_t)((A << 4) | (v >> 4)), 3);
        A = (uint8_t)((A & 0xF0) | (v & 0x0F));
        SETF((F & FC) | sz53p_table[A]);
        WZ = (uint16_t)(HL + 1);
        break;
    }
    case 0x6F: {   /* RLD */
        uint8_t v = bus_read(HL, 3);
        z80_addr_cycles(HL, 4);
        bus_write(HL, (uint8_t)((v << 4) | (A & 0x0F)), 3);
        A = (uint8_t)((A & 0xF0) | (v >> 4));
        SETF((F & FC) | sz53p_table[A]);
        WZ = (uint16_t)(HL + 1);
        break;
    }

    case 0xA0: z80_ldx(r, 1, 0); break;
    case 0xA8: z80_ldx(r, -1, 0); break;
    case 0xB0: z80_ldx(r, 1, 1); break;
    case 0xB8: z80_ldx(r, -1, 1); break;
    case 0xA1: z80_cpx(r, 1, 0); break;
    case 0xA9: z80_cpx(r, -1, 0); break;
    case 0xB1: z80_cpx(r, 1, 1); break;
    case 0xB9: z80_cpx(r, -1, 1); break;
    case 0xA2: z80_inx(r, 1, 0); break;
    case 0xAA: z80_inx(r, -1, 0); break;
    case 0xB2: z80_inx(r, 1, 1); break;
    case 0xBA: z80_inx(r, -1, 1); break;
    case 0xA3: z80_outx(r, 1, 0); break;
    case 0xAB: z80_outx(r, -1, 0); break;
    case 0xB3: z80_outx(r, 1, 1); break;
    case 0xBB: z80_outx(r, -1, 1); break;

    default: break;   /* ED inválido: NOP de 8 T (dos M1) */
    }
}

/* ---- (IX+d) ---- */

/* Lectura de d seguida de 5 T internos con la dirección de d en el bus. */
static inline uint16_t z80_xy_disp(ZxRegs *r, uint16_t base)
{
    int8_t d = (int8_t)bus_read(PC, 3);
    z80_addr_cycles(PC, 5);
    PC++;
    uint16_t a = (uint16_t)(base + d);
    WZ = a;
    return a;
}

/* ---- Interrupciones ---- */

/* HALT re-ejecuta su M1 con PC apuntando al propio HALT (convención de Fuse); al
 * aceptar una interrupción, PC avanza para apilar la dirección siguiente. */
static inline void z80_leave_halt(ZxRegs *r)
{
    if (r->halted) {
        r->halted = 0;
        PC++;
    }
}

static void z80_accept_int(ZxRegs *r)
{
    z80_leave_halt(r);
    if (r->ld_air)
        F &= (uint8_t)~FP;
    r->ld_air = 0;
    r->q = 0;              /* [VERIFICAR] docs §9: sin fuente para Q tras INTA */
    r->iff1 = r->iff2 = 0;
    z80_inc_r(r);
    /* INTA: M1 de 4 T + 2 T de espera automática + 1 T interno, sin MREQ, así que la
     * ULA no lo contiende (Fuse z80_interrupt: tstates += 7). */
    bus_tick(7);
    z80_push(r, PC);
    if (r->im == 2) {
        uint16_t v = (uint16_t)((r->i << 8) | bus_int_data());
        uint8_t lo = bus_read(v, 3);
        uint8_t hi = bus_read((uint16_t)(v + 1), 3);
        PC = (uint16_t)(lo | (hi << 8));
    } else {
        /* IM1 = RST 38h. IM0 ejecuta el byte del bus; en el 48K es 0xFF (RST 38h). Sólo
         * se modelan opcodes RST en IM0 [VERIFICAR: otros opcodes en IM0]. */
        uint8_t data = r->im == 0 ? bus_int_data() : 0xFF;
        PC = (data & 0xC7) == 0xC7 ? (uint16_t)(data & 0x38) : 0x0038;
    }
    WZ = PC;
}

static void z80_nmi(ZxRegs *r)
{
    z80_leave_halt(r);
    if (r->ld_air)
        F &= (uint8_t)~FP;
    r->ld_air = 0;
    r->ei_delay = 0;
    r->q = 0;              /* [VERIFICAR] docs §9: sin fuente para Q tras NMI */
    r->iff1 = 0;
    z80_inc_r(r);
    bus_tick(5);   /* M1 de NMI de 5 T (Fuse z80_nmi) */
    z80_push(r, PC);
    PC = 0x0066;
    WZ = PC;       /* [VERIFICAR] como un RST 66h */
}

static void z80_power_on(ZxRegs *r)
{
    zx_memset(r, 0, sizeof *r);
    r->af.w = 0xFFFF;
    r->sp.w = 0xFFFF;
}

/* ---- Bucle de una instrucción ---- */

static void z80_step(ZxRegs *r)
{
    if (r->iff1 && !r->ei_delay && bus_int_line()) {
        z80_accept_int(r);
        return;
    }
    /* ei_delay = 0xDD/0xFD: el paso anterior acabó en el M1 de un prefijo (ver index). */
    unsigned prefix = r->ei_delay;
    r->ei_delay = 0;
    r->ld_air = 0;
    if (r->halted) {
        (void)bus_read(PC, 4);
        z80_inc_r(r);
        r->q = 0;
        return;
    }

    uint8_t qprev = r->q;
    r->q = 0;
    ZxPair *xy;
    /* Prefijo pendiente: su M1 ya se hizo; se despacha sin otro fetch (saltar a index
     * directamente haría el grafo irreducible y wasm lo paga: medido +13 %). */
    unsigned op = prefix > 1 ? prefix : z80_fetch(r);

dispatch:
    switch (op) {
    case 0x00: break;
    case 0x01: BC = z80_imm16(r); break;
    case 0x02: bus_write(BC, A, 3); WZ = (uint16_t)(((BC + 1) & 0xFF) | (A << 8)); break;
    case 0x03: z80_ir_cycles(r, 2); BC++; break;
    case 0x04: B = z80_inc8(r, B); break;
    case 0x05: B = z80_dec8(r, B); break;
    case 0x06: B = z80_imm8(r); break;
    case 0x07:
        A = (uint8_t)((A << 1) | (A >> 7));
        SETF((F & (FS | FZ | FP)) | (A & (F3 | F5 | FC)));
        break;
    case 0x08: {
        uint16_t t = AF;
        AF = r->af_.w;
        r->af_.w = t;
        break;
    }
    case 0x09: z80_ir_cycles(r, 7); HL = z80_add16(r, HL, BC); break;
    case 0x0A: A = bus_read(BC, 3); WZ = (uint16_t)(BC + 1); break;
    case 0x0B: z80_ir_cycles(r, 2); BC--; break;
    case 0x0C: C = z80_inc8(r, C); break;
    case 0x0D: C = z80_dec8(r, C); break;
    case 0x0E: C = z80_imm8(r); break;
    case 0x0F:
        SETF((F & (FS | FZ | FP)) | (A & FC));
        A = (uint8_t)((A >> 1) | (A << 7));
        SETF(F | (A & (F3 | F5)));
        break;

    case 0x10:
        bus_contend(IR, 1);
        B--;
        if (B) z80_jr(r); else z80_jr_skip(r);
        break;
    case 0x11: DE = z80_imm16(r); break;
    case 0x12: bus_write(DE, A, 3); WZ = (uint16_t)(((DE + 1) & 0xFF) | (A << 8)); break;
    case 0x13: z80_ir_cycles(r, 2); DE++; break;
    case 0x14: D = z80_inc8(r, D); break;
    case 0x15: D = z80_dec8(r, D); break;
    case 0x16: D = z80_imm8(r); break;
    case 0x17: {
        unsigned c = A >> 7;
        A = (uint8_t)((A << 1) | (F & FC));
        SETF((F & (FS | FZ | FP)) | (A & (F3 | F5)) | c);
        break;
    }
    case 0x18: z80_jr(r); break;
    case 0x19: z80_ir_cycles(r, 7); HL = z80_add16(r, HL, DE); break;
    case 0x1A: A = bus_read(DE, 3); WZ = (uint16_t)(DE + 1); break;
    case 0x1B: z80_ir_cycles(r, 2); DE--; break;
    case 0x1C: E = z80_inc8(r, E); break;
    case 0x1D: E = z80_dec8(r, E); break;
    case 0x1E: E = z80_imm8(r); break;
    case 0x1F: {
        unsigned c = A & 1;
        A = (uint8_t)((A >> 1) | (F << 7));
        SETF((F & (FS | FZ | FP)) | (A & (F3 | F5)) | c);
        break;
    }

    case 0x20: if (CC_NZ) z80_jr(r); else z80_jr_skip(r); break;
    case 0x21: HL = z80_imm16(r); break;
    case 0x22: z80_ld_nn_rr(r, HL); break;
    case 0x23: z80_ir_cycles(r, 2); HL++; break;
    case 0x24: H = z80_inc8(r, H); break;
    case 0x25: H = z80_dec8(r, H); break;
    case 0x26: H = z80_imm8(r); break;
    case 0x27: {   /* DAA */
        unsigned corr = 0, c = F & FC, lo = A & 0x0F, h;
        if ((F & FH) || lo > 9) corr = 0x06;
        if (c || A > 0x99) { corr |= 0x60; c = FC; }
        if (F & FN) {
            h = ((F & FH) && lo < 6) ? FH : 0;
            A = (uint8_t)(A - corr);
        } else {
            h = lo > 9 ? FH : 0;
            A = (uint8_t)(A + corr);
        }
        SETF(sz53p_table[A] | c | (F & FN) | h);
        break;
    }
    case 0x28: if (CC_Z) z80_jr(r); else z80_jr_skip(r); break;
    case 0x29: z80_ir_cycles(r, 7); HL = z80_add16(r, HL, HL); break;
    case 0x2A: HL = z80_ld_rr_nn(r); break;
    case 0x2B: z80_ir_cycles(r, 2); HL--; break;
    case 0x2C: L = z80_inc8(r, L); break;
    case 0x2D: L = z80_dec8(r, L); break;
    case 0x2E: L = z80_imm8(r); break;
    case 0x2F:
        A = (uint8_t)~A;
        SETF((F & (FS | FZ | FP | FC)) | FH | FN | (A & (F3 | F5)));
        break;

    case 0x30: if (CC_NC) z80_jr(r); else z80_jr_skip(r); break;
    case 0x31: SP = z80_imm16(r); break;
    case 0x32: {
        uint16_t a = z80_imm16(r);
        bus_write(a, A, 3);
        WZ = (uint16_t)(((a + 1) & 0xFF) | (A << 8));
        break;
    }
    case 0x33: z80_ir_cycles(r, 2); SP++; break;
    case 0x34: {
        uint8_t v = bus_read(HL, 3);
        bus_contend(HL, 1);
        bus_write(HL, z80_inc8(r, v), 3);
        break;
    }
    case 0x35: {
        uint8_t v = bus_read(HL, 3);
        bus_contend(HL, 1);
        bus_write(HL, z80_dec8(r, v), 3);
        break;
    }
    case 0x36: { uint8_t v = z80_imm8(r); bus_write(HL, v, 3); break; }
    /* SCF/CCF: XF/YF = ((Q ^ F) | A), variante Zilog NMOS (docs §9). */
    case 0x37:
        SETF((F & (FS | FZ | FP)) | (((qprev ^ F) | A) & (F3 | F5)) | FC);
        break;
    case 0x38: if (CC_C) z80_jr(r); else z80_jr_skip(r); break;
    case 0x39: z80_ir_cycles(r, 7); HL = z80_add16(r, HL, SP); break;
    case 0x3A: {
        uint16_t a = z80_imm16(r);
        A = bus_read(a, 3);
        WZ = (uint16_t)(a + 1);
        break;
    }
    case 0x3B: z80_ir_cycles(r, 2); SP--; break;
    case 0x3C: A = z80_inc8(r, A); break;
    case 0x3D: A = z80_dec8(r, A); break;
    case 0x3E: A = z80_imm8(r); break;
    case 0x3F:
        SETF((F & (FS | FZ | FP)) | (((qprev ^ F) | A) & (F3 | F5)) | ((F & FC) ? FH : FC));
        break;

    /* LD r,r' */
    case 0x40: break;
    case 0x41: B = C; break;
    case 0x42: B = D; break;
    case 0x43: B = E; break;
    case 0x44: B = H; break;
    case 0x45: B = L; break;
    case 0x46: B = bus_read(HL, 3); break;
    case 0x47: B = A; break;
    case 0x48: C = B; break;
    case 0x49: break;
    case 0x4A: C = D; break;
    case 0x4B: C = E; break;
    case 0x4C: C = H; break;
    case 0x4D: C = L; break;
    case 0x4E: C = bus_read(HL, 3); break;
    case 0x4F: C = A; break;
    case 0x50: D = B; break;
    case 0x51: D = C; break;
    case 0x52: break;
    case 0x53: D = E; break;
    case 0x54: D = H; break;
    case 0x55: D = L; break;
    case 0x56: D = bus_read(HL, 3); break;
    case 0x57: D = A; break;
    case 0x58: E = B; break;
    case 0x59: E = C; break;
    case 0x5A: E = D; break;
    case 0x5B: break;
    case 0x5C: E = H; break;
    case 0x5D: E = L; break;
    case 0x5E: E = bus_read(HL, 3); break;
    case 0x5F: E = A; break;
    case 0x60: H = B; break;
    case 0x61: H = C; break;
    case 0x62: H = D; break;
    case 0x63: H = E; break;
    case 0x64: break;
    case 0x65: H = L; break;
    case 0x66: H = bus_read(HL, 3); break;
    case 0x67: H = A; break;
    case 0x68: L = B; break;
    case 0x69: L = C; break;
    case 0x6A: L = D; break;
    case 0x6B: L = E; break;
    case 0x6C: L = H; break;
    case 0x6D: break;
    case 0x6E: L = bus_read(HL, 3); break;
    case 0x6F: L = A; break;
    case 0x70: bus_write(HL, B, 3); break;
    case 0x71: bus_write(HL, C, 3); break;
    case 0x72: bus_write(HL, D, 3); break;
    case 0x73: bus_write(HL, E, 3); break;
    case 0x74: bus_write(HL, H, 3); break;
    case 0x75: bus_write(HL, L, 3); break;
    case 0x76: r->halted = 1; PC--; break;   /* HALT: ver z80_leave_halt */
    case 0x77: bus_write(HL, A, 3); break;
    case 0x78: A = B; break;
    case 0x79: A = C; break;
    case 0x7A: A = D; break;
    case 0x7B: A = E; break;
    case 0x7C: A = H; break;
    case 0x7D: A = L; break;
    case 0x7E: A = bus_read(HL, 3); break;
    case 0x7F: break;

    /* ALU A,r: el grupo lo dan los bits 5..3 */
    case 0x80: case 0x88: case 0x90: case 0x98: case 0xA0: case 0xA8: case 0xB0: case 0xB8:
        z80_alu(r, op, B); break;
    case 0x81: case 0x89: case 0x91: case 0x99: case 0xA1: case 0xA9: case 0xB1: case 0xB9:
        z80_alu(r, op, C); break;
    case 0x82: case 0x8A: case 0x92: case 0x9A: case 0xA2: case 0xAA: case 0xB2: case 0xBA:
        z80_alu(r, op, D); break;
    case 0x83: case 0x8B: case 0x93: case 0x9B: case 0xA3: case 0xAB: case 0xB3: case 0xBB:
        z80_alu(r, op, E); break;
    case 0x84: case 0x8C: case 0x94: case 0x9C: case 0xA4: case 0xAC: case 0xB4: case 0xBC:
        z80_alu(r, op, H); break;
    case 0x85: case 0x8D: case 0x95: case 0x9D: case 0xA5: case 0xAD: case 0xB5: case 0xBD:
        z80_alu(r, op, L); break;
    case 0x86: case 0x8E: case 0x96: case 0x9E: case 0xA6: case 0xAE: case 0xB6: case 0xBE:
        z80_alu(r, op, bus_read(HL, 3)); break;
    case 0x87: case 0x8F: case 0x97: case 0x9F: case 0xA7: case 0xAF: case 0xB7: case 0xBF:
        z80_alu(r, op, A); break;

    case 0xC0: z80_ret_cc(r, CC_NZ); break;
    case 0xC1: BC = z80_pop(r); break;
    case 0xC2: WZ = z80_imm16(r); if (CC_NZ) PC = WZ; break;
    case 0xC3: WZ = z80_imm16(r); PC = WZ; break;
    case 0xC4: z80_call(r, CC_NZ); break;
    case 0xC5: bus_contend(IR, 1); z80_push(r, BC); break;
    case 0xC6: z80_add8(r, z80_imm8(r), 0); break;
    case 0xC7: z80_rst(r, 0x00); break;
    case 0xC8: z80_ret_cc(r, CC_Z); break;
    case 0xC9: PC = z80_pop(r); WZ = PC; break;
    case 0xCA: WZ = z80_imm16(r); if (CC_Z) PC = WZ; break;
    case 0xCB: z80_cb(r); break;
    case 0xCC: z80_call(r, CC_Z); break;
    case 0xCD: z80_call(r, 1); break;
    case 0xCE: { uint8_t v = z80_imm8(r); z80_add8(r, v, F & FC); break; }
    case 0xCF: z80_rst(r, 0x08); break;

    case 0xD0: z80_ret_cc(r, CC_NC); break;
    case 0xD1: DE = z80_pop(r); break;
    case 0xD2: WZ = z80_imm16(r); if (CC_NC) PC = WZ; break;
    case 0xD3: {   /* OUT (n),A: A en el byte alto del puerto */
        uint8_t n = z80_imm8(r);
        bus_out((uint16_t)((A << 8) | n), A);
        WZ = (uint16_t)(((n + 1) & 0xFF) | (A << 8));
        break;
    }
    case 0xD4: z80_call(r, CC_NC); break;
    case 0xD5: bus_contend(IR, 1); z80_push(r, DE); break;
    case 0xD6: z80_sub8(r, z80_imm8(r), 0); break;
    case 0xD7: z80_rst(r, 0x10); break;
    case 0xD8: z80_ret_cc(r, CC_C); break;
    case 0xD9: {
        uint16_t t;
        t = BC; BC = r->bc_.w; r->bc_.w = t;
        t = DE; DE = r->de_.w; r->de_.w = t;
        t = HL; HL = r->hl_.w; r->hl_.w = t;
        break;
    }
    case 0xDA: WZ = z80_imm16(r); if (CC_C) PC = WZ; break;
    case 0xDB: {
        uint16_t port = (uint16_t)((A << 8) | z80_imm8(r));
        A = bus_in(port);
        WZ = (uint16_t)(port + 1);
        break;
    }
    case 0xDC: z80_call(r, CC_C); break;
    case 0xDD: xy = &r->ix; goto index;
    case 0xDE: { uint8_t v = z80_imm8(r); z80_sub8(r, v, F & FC); break; }
    case 0xDF: z80_rst(r, 0x18); break;

    case 0xE0: z80_ret_cc(r, CC_PO); break;
    case 0xE1: HL = z80_pop(r); break;
    case 0xE2: WZ = z80_imm16(r); if (CC_PO) PC = WZ; break;
    case 0xE3: {   /* EX (SP),HL */
        uint8_t lo = bus_read(SP, 3);
        uint8_t hi = bus_read((uint16_t)(SP + 1), 3);
        bus_contend((uint16_t)(SP + 1), 1);
        bus_write((uint16_t)(SP + 1), H, 3);
        bus_write(SP, L, 3);
        bus_contend(SP, 1);
        bus_contend(SP, 1);
        HL = (uint16_t)(lo | (hi << 8));
        WZ = HL;
        break;
    }
    case 0xE4: z80_call(r, CC_PO); break;
    case 0xE5: bus_contend(IR, 1); z80_push(r, HL); break;
    case 0xE6: { uint8_t v = z80_imm8(r); A &= v; SETF(sz53p_table[A] | FH); break; }
    case 0xE7: z80_rst(r, 0x20); break;
    case 0xE8: z80_ret_cc(r, CC_PE); break;
    case 0xE9: PC = HL; break;
    case 0xEA: WZ = z80_imm16(r); if (CC_PE) PC = WZ; break;
    case 0xEB: { uint16_t t = DE; DE = HL; HL = t; break; }
    case 0xEC: z80_call(r, CC_PE); break;
    case 0xED: z80_ed(r); break;
    case 0xEE: { uint8_t v = z80_imm8(r); A ^= v; SETF(sz53p_table[A]); break; }
    case 0xEF: z80_rst(r, 0x28); break;

    case 0xF0: z80_ret_cc(r, CC_P); break;
    case 0xF1: AF = z80_pop(r); break;
    case 0xF2: WZ = z80_imm16(r); if (CC_P) PC = WZ; break;
    case 0xF3: r->iff1 = r->iff2 = 0; break;
    case 0xF4: z80_call(r, CC_P); break;
    case 0xF5: bus_contend(IR, 1); z80_push(r, AF); break;
    case 0xF6: { uint8_t v = z80_imm8(r); A |= v; SETF(sz53p_table[A]); break; }
    case 0xF7: z80_rst(r, 0x30); break;
    case 0xF8: z80_ret_cc(r, CC_M); break;
    case 0xF9: z80_ir_cycles(r, 2); SP = HL; break;
    case 0xFA: WZ = z80_imm16(r); if (CC_M) PC = WZ; break;
    /* EI: la INT no se acepta hasta después de la instrucción siguiente. */
    case 0xFB: r->iff1 = r->iff2 = 1; r->ei_delay = 1; break;
    case 0xFC: z80_call(r, CC_M); break;
    case 0xFD: xy = &r->iy; goto index;
    case 0xFE: z80_cp8(r, z80_imm8(r)); break;
    case 0xFF: z80_rst(r, 0x38); break;
    }
    return;

    /* Prefijo DD/FD: el siguiente opcode es otro M1. Si no usa HL/H/L/(HL), el
     * prefijo sólo ha costado 4 T y el opcode se ejecuta tal cual (también ED).
     * Si el opcode es otro DD/FD, el primero ha sido un NOP de 4 T y el paso termina
     * aquí, con el M1 del nuevo prefijo hecho (como Fuse, una cadena larga no es un
     * único paso). ei_delay guarda qué prefijo sigue pendiente: además de decirle al
     * paso siguiente que continúe en index sin otro M1, impide aceptar la INT entre
     * prefijo y opcode (Sean Young, "The Undocumented Z80 Documented": la INT sólo se
     * acepta tras la instrucción completa). */
index:
#define XY  xy->w
#define XYH xy->b.h
#define XYL xy->b.l
    /* El prefijo es una instrucción que no escribe F: Q vale 0 para SCF/CCF tras él
     * (SingleStepTests DD/FD 37/3F). */
    qprev = 0;
    op = z80_fetch(r);
    switch (op) {
    case 0x09: z80_ir_cycles(r, 7); XY = z80_add16(r, XY, BC); break;
    case 0x19: z80_ir_cycles(r, 7); XY = z80_add16(r, XY, DE); break;
    case 0x29: z80_ir_cycles(r, 7); XY = z80_add16(r, XY, XY); break;
    case 0x39: z80_ir_cycles(r, 7); XY = z80_add16(r, XY, SP); break;
    case 0x21: XY = z80_imm16(r); break;
    case 0x22: z80_ld_nn_rr(r, XY); break;
    case 0x23: z80_ir_cycles(r, 2); XY++; break;
    case 0x24: XYH = z80_inc8(r, XYH); break;
    case 0x25: XYH = z80_dec8(r, XYH); break;
    case 0x26: XYH = z80_imm8(r); break;
    case 0x2A: XY = z80_ld_rr_nn(r); break;
    case 0x2B: z80_ir_cycles(r, 2); XY--; break;
    case 0x2C: XYL = z80_inc8(r, XYL); break;
    case 0x2D: XYL = z80_dec8(r, XYL); break;
    case 0x2E: XYL = z80_imm8(r); break;
    case 0x34: {
        uint16_t a = z80_xy_disp(r, XY);
        uint8_t v = bus_read(a, 3);
        bus_contend(a, 1);
        bus_write(a, z80_inc8(r, v), 3);
        break;
    }
    case 0x35: {
        uint16_t a = z80_xy_disp(r, XY);
        uint8_t v = bus_read(a, 3);
        bus_contend(a, 1);
        bus_write(a, z80_dec8(r, v), 3);
        break;
    }
    case 0x36: {   /* LD (IX+d),n: d y n se leen seguidos; 2 T internos sobre n */
        int8_t d = (int8_t)bus_read(PC, 3);
        PC++;
        uint8_t v = bus_read(PC, 3);
        bus_contend(PC, 1);
        bus_contend(PC, 1);
        PC++;
        uint16_t a = (uint16_t)(XY + d);
        WZ = a;
        bus_write(a, v, 3);
        break;
    }

    case 0x44: B = XYH; break;
    case 0x45: B = XYL; break;
    case 0x46: B = bus_read(z80_xy_disp(r, XY), 3); break;
    case 0x4C: C = XYH; break;
    case 0x4D: C = XYL; break;
    case 0x4E: C = bus_read(z80_xy_disp(r, XY), 3); break;
    case 0x54: D = XYH; break;
    case 0x55: D = XYL; break;
    case 0x56: D = bus_read(z80_xy_disp(r, XY), 3); break;
    case 0x5C: E = XYH; break;
    case 0x5D: E = XYL; break;
    case 0x5E: E = bus_read(z80_xy_disp(r, XY), 3); break;
    case 0x60: XYH = B; break;
    case 0x61: XYH = C; break;
    case 0x62: XYH = D; break;
    case 0x63: XYH = E; break;
    case 0x64: break;
    case 0x65: XYH = XYL; break;
    case 0x66: H = bus_read(z80_xy_disp(r, XY), 3); break;   /* H real */
    case 0x67: XYH = A; break;
    case 0x68: XYL = B; break;
    case 0x69: XYL = C; break;
    case 0x6A: XYL = D; break;
    case 0x6B: XYL = E; break;
    case 0x6C: XYL = XYH; break;
    case 0x6D: break;
    case 0x6E: L = bus_read(z80_xy_disp(r, XY), 3); break;   /* L real */
    case 0x6F: XYL = A; break;
    case 0x70: { uint16_t a = z80_xy_disp(r, XY); bus_write(a, B, 3); break; }
    case 0x71: { uint16_t a = z80_xy_disp(r, XY); bus_write(a, C, 3); break; }
    case 0x72: { uint16_t a = z80_xy_disp(r, XY); bus_write(a, D, 3); break; }
    case 0x73: { uint16_t a = z80_xy_disp(r, XY); bus_write(a, E, 3); break; }
    case 0x74: { uint16_t a = z80_xy_disp(r, XY); bus_write(a, H, 3); break; }
    case 0x75: { uint16_t a = z80_xy_disp(r, XY); bus_write(a, L, 3); break; }
    case 0x77: { uint16_t a = z80_xy_disp(r, XY); bus_write(a, A, 3); break; }
    case 0x7C: A = XYH; break;
    case 0x7D: A = XYL; break;
    case 0x7E: A = bus_read(z80_xy_disp(r, XY), 3); break;

    case 0x84: case 0x8C: case 0x94: case 0x9C: case 0xA4: case 0xAC: case 0xB4: case 0xBC:
        z80_alu(r, op, XYH); break;
    case 0x85: case 0x8D: case 0x95: case 0x9D: case 0xA5: case 0xAD: case 0xB5: case 0xBD:
        z80_alu(r, op, XYL); break;
    case 0x86: case 0x8E: case 0x96: case 0x9E: case 0xA6: case 0xAE: case 0xB6: case 0xBE:
        z80_alu(r, op, bus_read(z80_xy_disp(r, XY), 3)); break;

    case 0xCB: z80_xycb(r, XY); break;
    case 0xE1: XY = z80_pop(r); break;
    case 0xE3: {
        uint8_t lo = bus_read(SP, 3);
        uint8_t hi = bus_read((uint16_t)(SP + 1), 3);
        bus_contend((uint16_t)(SP + 1), 1);
        bus_write((uint16_t)(SP + 1), XYH, 3);
        bus_write(SP, XYL, 3);
        bus_contend(SP, 1);
        bus_contend(SP, 1);
        XY = (uint16_t)(lo | (hi << 8));
        WZ = XY;
        break;
    }
    case 0xE5: bus_contend(IR, 1); z80_push(r, XY); break;
    case 0xE9: PC = XY; break;
    case 0xF9: z80_ir_cycles(r, 2); SP = XY; break;

    case 0xDD: case 0xFD:
        r->ei_delay = (uint8_t)op;
        return;
    default: goto dispatch;
    }
#undef XY
#undef XYH
#undef XYL
}

#undef FC
#undef FN
#undef FP
#undef F3
#undef FH
#undef F5
#undef FZ
#undef FS
#undef Z80_PAR
#undef Z80_SZ53
#undef Z80_SZ53P
#undef Z80_T4
#undef Z80_T16
#undef Z80_T64
#undef Z80_T256
#undef A
#undef F
#undef B
#undef C
#undef D
#undef E
#undef H
#undef L
#undef AF
#undef BC
#undef DE
#undef HL
#undef SP
#undef PC
#undef WZ
#undef IR
#undef SETF
#undef CC_NZ
#undef CC_Z
#undef CC_NC
#undef CC_C
#undef CC_PO
#undef CC_PE
#undef CC_P
#undef CC_M
