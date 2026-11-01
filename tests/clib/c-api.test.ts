// L1: la librería llamada desde C compilado por K1 (no desde el arnés de ensamblador):
// IM 2 con una función C como rutina de interrupción, string.h/stdlib.h y printf con
// argumentos variables. Valores esperados escritos a mano.
import { describe, expect, it } from "vitest";
import { runC } from "./charness";

describe("API desde C", () => {
  it("im2_install(tick) con una función C: se llama una vez por frame; im2_remove vuelve a IM 1", async () => {
    const r = await runC(`
#include <spectrum.h>
unsigned int ticks;
unsigned int before, after;
void tick(void) { ticks++; }
int main(void) {
    unsigned char i;
    wait_frame();
    before = frames();
    im2_install(tick);
    for (i = 0; i < 20; i++) wait_frame();
    im2_remove();
    after = frames();
    for (i = 0; i < 5; i++) wait_frame();
    return 0;
}`);
    r.frames(40);
    expect(r.back()).toBe(true);
    const ram = r.p.ram();
    const u16 = (n: string) => ram[r.sym(n)]! | (ram[r.sym(n) + 1]! << 8);
    expect(u16("_ticks")).toBeGreaterThanOrEqual(20);
    expect(u16("_ticks")).toBeLessThanOrEqual(21);
    expect((u16("_after") - u16("_before")) & 0xffff).toBe(u16("_ticks"));
    expect(r.p.regs.get8("im")).toBe(1);
  });

  it("string.h, stdlib.h y printf desde C", async () => {
    const r = await runC(`
#include <spectrum.h>
#include <string.h>
#include <stdlib.h>
char buf[20];
int main(void) {
    cls();
    strcpy(buf, "Spectrum");
    printf("%s %u %d\\n", buf, strlen(buf), strcmp(buf, "Spectrum"));
    memset(buf, '*', 5);
    buf[5] = 0;
    printf("[%s] %d %d\\n", buf, abs(-123), memcmp("ab", "ac", 2));
    srand(1);
    printf("%u", rand());
    return 0;
}`);
    r.frames(10);
    const t = r.text().map((l) => l.trimEnd());
    expect(t[0]).toBe("Spectrum 8 0");
    expect(t[1]).toBe("[*****] 123 -1");
    // xorshift (7,9,8) desde 1: 1 ^ 1<<7 = 129; ^ 129>>9 = 129; ^ 129<<8 = 0x8181 → & 7FFFh = 0x0181.
    expect(t[2]).toBe(String(0x0181));
    expect(r.back()).toBe(true);
  });
});
