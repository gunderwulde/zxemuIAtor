/*
 * m1_harness.c — banco de pruebas de M1 (sólo tests de tests/core/machine).
 *
 * Incluye zx48.c tal cual (con la CPU que haya en z80.c) y expone a JS los ciclos de
 * bus de la máquina, para probar la contención de E/S, el puerto 0xFE, el bus flotante
 * y el instante en que la ULA ve escrituras y OUT sin depender de que la CPU ejecute
 * IN/OUT/LD de verdad. El resto de módulos (video.c, audio.c…) se enlaza aparte.
 * Lo compila tests/core/machine/harness.ts; NO forma parte de ningún .wasm del núcleo.
 */
#include "../../../core/src/zx48.c"

#define H_EXPORT(name) __attribute__((export_name(#name)))

H_EXPORT(h_in)     uint32_t h_in(uint32_t port)              { return bus_in((uint16_t)port); }
H_EXPORT(h_out)    void     h_out(uint32_t port, uint32_t v) { bus_out((uint16_t)port, (uint8_t)v); }
H_EXPORT(h_read)   uint32_t h_read(uint32_t a)               { return bus_read((uint16_t)a, 3); }
H_EXPORT(h_write)  void     h_write(uint32_t a, uint32_t v)  { bus_write((uint16_t)a, (uint8_t)v, 3); }
/* Cierra el frame como si la CPU hubiera llegado a 69888 (zx.t nunca queda "negativo"). */
H_EXPORT(h_end_frame) void  h_end_frame(void)
{
    if (zx.t < ZX_TSTATES_PER_FRAME)
        zx.t = ZX_TSTATES_PER_FRAME;
    end_frame();
}
