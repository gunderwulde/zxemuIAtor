/*
 * testbus.h — ABI de core-test.wasm: la CPU sola sobre 64 KB planos, sin contención.
 * CONGELADO; sólo lo modifica el coordinador. Lo usan los runners CPU-* de
 * docs/TEST-PLAN.md (FUSE, SingleStepTests, zexdoc/zexall).
 *
 * Puertos: bus_in devuelve el siguiente valor de la cola de lecturas si queda alguno;
 * si no, el byte alto del puerto (convención de los tests de FUSE).
 */
#ifndef TESTBUS_H
#define TESTBUS_H

#include "zx.h"

#define TB_PORT_QUEUE_MAX 256

ZX_EXPORT(tb_reset)         void        tb_reset(void);           /* mem=0, CPU encendida, t=0, logs vacíos */
ZX_EXPORT(tb_mem)           uint8_t    *tb_mem(void);             /* 64 KB */
ZX_EXPORT(tb_regs)          ZxRegs     *tb_regs(void);
ZX_EXPORT(tb_tstates)       uint32_t    tb_tstates(void);
ZX_EXPORT(tb_set_tstates)   void        tb_set_tstates(uint32_t t);
ZX_EXPORT(tb_step)          void        tb_step(void);            /* una llamada a z80_step */
ZX_EXPORT(tb_run)           uint32_t    tb_run(uint32_t until);   /* z80_step mientras t < until */
/* z80_step mientras t < until y PC != stop_pc (comprobado en cada límite de instrucción,
 * también antes del primer paso). Para trampas tipo BDOS sin salir a JS por instrucción. */
ZX_EXPORT(tb_run_to)        uint32_t    tb_run_to(uint32_t until, uint32_t stop_pc);
ZX_EXPORT(tb_set_int)       void        tb_set_int(uint32_t active);
ZX_EXPORT(tb_set_int_data)  void        tb_set_int_data(uint32_t v);
ZX_EXPORT(tb_nmi)           void        tb_nmi(void);
ZX_EXPORT(tb_log_enable)    void        tb_log_enable(uint32_t on);  /* también vacía el log */
ZX_EXPORT(tb_events)        ZxBusEvent *tb_events(void);
ZX_EXPORT(tb_event_count)   uint32_t    tb_event_count(void);
ZX_EXPORT(tb_port_queue)    uint8_t    *tb_port_queue(void);      /* TB_PORT_QUEUE_MAX bytes */
ZX_EXPORT(tb_port_queue_set) void       tb_port_queue_set(uint32_t n);  /* n valores cargados, cursor a 0 */

#endif /* TESTBUS_H */
