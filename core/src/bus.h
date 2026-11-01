/*
 * bus.h — contrato CPU <-> máquina. CONGELADO; sólo lo modifica el coordinador.
 *
 * La CPU (z80.c) no conoce el Spectrum: todo acceso a memoria, E/S y tiempo pasa por
 * estas funciones. No hay punteros a función: cada máquina (zx48.c, testbus.c) define
 * estas funciones como `static inline` y DESPUÉS hace `#include "z80.c"` (unity build).
 * Así el compilador las integra en el bucle de la CPU sin indirecciones.
 *
 * Tiempo: el contador de T-states vive en la máquina. Cada función que avanza el
 * tiempo aplica PRIMERO la contención del instante actual para la dirección dada y
 * DESPUÉS suma los T-states del ciclo. Es exactamente el modelo de Fuse, y los
 * eventos se registran con su convención (tests.expected):
 *
 *     bus_read(a, 3)   ->  "t   MC a"   contención en t, t += 3
 *                          "t+3 MR a v" lectura
 *
 * La CPU escribe los ciclos de cada instrucción en su orden real (AGENTS.md §4.1.4).
 * Ejemplo, INC (HL) = pc:4, hl:3, hl:1, hl(write):3:
 *
 *     op = bus_read(pc, 4);          // M1 (incluye refresco)
 *     v  = bus_read(hl, 3);
 *     bus_contend(hl, 1);            // ciclo interno con HL en el bus
 *     bus_write(hl, v + 1, 3);
 *
 * Funciones que cada máquina DEBE definir antes de incluir z80.c:
 *
 *   static inline uint8_t bus_read(uint16_t addr, uint32_t t);
 *       Contención(addr) + t T-states + lectura. t = 4 para M1, 3 para lectura normal.
 *       (M1 de 4 T y lectura de 3 T; los M1 de 5/6 T se expresan como
 *       bus_read(pc,4) + bus_contend(ir, 1)…)
 *
 *   static inline void bus_write(uint16_t addr, uint8_t value, uint32_t t);
 *       Contención(addr) + t T-states + escritura (la ROM la ignora la máquina).
 *
 *   static inline void bus_contend(uint16_t addr, uint32_t t);
 *       Ciclo sin acceso a memoria con `addr` en el bus (p. ej. IR durante ciclos
 *       internos, HL en INC (HL)): contención(addr) + t T-states. Si t > 1 y el
 *       hardware contiende en cada T (p. ej. "hl:1 ×2"), la CPU lo llama dos veces
 *       con t = 1; nunca agrupa lo que el hardware separa.
 *
 *   static inline void bus_tick(uint32_t t);
 *       T-states internos sin dirección en el bus (no contendidos).
 *
 *   static inline uint8_t bus_in(uint16_t port);
 *   static inline void    bus_out(uint16_t port, uint8_t value);
 *       Ciclo de E/S completo de 4 T, incluida la contención de E/S de la ULA
 *       (docs/zx48-hardware.md §5). Registro de eventos (convención de coretest.c
 *       de Fuse; "PC" marca cada punto en que la ULA puede contender):
 *           si byte alto en 0x40-0x7F: "t PC port"
 *           t += 1; "t PR port v" (o PW)
 *           si bit 0 == 0:                 "t PC port"; t += 3
 *           si bit 0 == 1 y alto 0x40-0x7F: 3 × ("t PC port"; t += 1)
 *           en otro caso:                  t += 3
 *
 *   static inline int bus_int_line(void);
 *       1 si /INT está activa en este instante (la CPU lo consulta entre instrucciones).
 *
 *   static inline uint8_t bus_int_data(void);
 *       Valor del bus de datos durante INTA (0xFF en el Spectrum 48K).
 *
 * Lo que z80.c ofrece a la máquina (definido en z80.c, también static):
 *
 *   static void z80_power_on(ZxRegs *r);  // estado de encendido
 *   static void z80_step(ZxRegs *r);      // una instrucción completa, o la aceptación
 *                                          // de una INT pendiente si procede
 *   static void z80_nmi(ZxRegs *r);       // acepta una NMI (no usada en el 48K)
 */
#ifndef BUS_H
#define BUS_H

#include "base.h"

#endif /* BUS_H */
