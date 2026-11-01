// Los ejemplos de web/src/asm/examples deben ensamblar sin errores (los usa el IDE).
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemble } from "../../web/src/asm/index";

it("hello.asm", () => {
  const r = assemble(readFileSync(resolve(__dirname, "../../web/src/asm/examples/hello.asm"), "utf8"));
  expect(r.errors).toEqual([]);
  expect(r.entry).toBe(0x8000);
  expect(r.segments).toHaveLength(1);
  // ld a,2 / call 1601h / ld hl,message (message = 8000h + 28 bytes de código)
  expect([...r.segments[0]!.bytes.subarray(0, 8)]).toEqual([0x3e, 0x02, 0xcd, 0x01, 0x16, 0x21, 0x1c, 0x80]);
  expect(r.symbols.get("message")).toBe(0x801c);
});
