// Oráculo: fuentes originales de ZEXDOC/ZEXALL (Frank Cringle, versión de agn453/ZEXALL)
// frente a los .com publicados en el mismo repositorio.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemble } from "../../web/src/asm/index";

const DIR = resolve(__dirname, "../fixtures/zex");

for (const name of ["zexdoc", "zexall"]) {
  const src = resolve(DIR, `${name}.z80`);
  const com = resolve(DIR, `${name}.com`);
  describe.skipIf(!existsSync(src) || !existsSync(com))(name, () => {
    it("ensambla idéntico byte a byte al .com", () => {
      const r = assemble(readFileSync(src, "latin1"), { org: 0 });
      expect(r.errors.filter((e) => e.severity === "error")).toEqual([]);
      expect(r.segments.length).toBe(1);
      const seg = r.segments[0]!;
      expect(seg.addr).toBe(0x100);
      const ref = new Uint8Array(readFileSync(com));
      // El .com de CP/M se rellena hasta múltiplo de 128 bytes con basura de memoria:
      // se compara el tramo ensamblado y se exige que el relleno sea < 128 bytes.
      expect(ref.length - seg.bytes.length).toBeGreaterThanOrEqual(0);
      expect(ref.length - seg.bytes.length).toBeLessThan(128);
      let firstDiff = -1;
      for (let i = 0; i < seg.bytes.length; i++) if (seg.bytes[i] !== ref[i]) { firstDiff = i; break; }
      expect(firstDiff, `primer byte distinto en ${(0x100 + firstDiff).toString(16)}`).toBe(-1);
    });
  });
}
