// Hash estable de un framebuffer RGBA 352×296 para tests de regresión (SYS-06/07).
// NO es un oráculo de exactitud: sólo detecta cambios (docs/TEST-PLAN.md §5).
import { createHash } from "node:crypto";

/** SHA-256 en hex (64 caracteres) de los bytes del framebuffer. */
export function fbHash(fb: Uint8Array | Uint8ClampedArray): string {
  return createHash("sha256").update(new Uint8Array(fb.buffer, fb.byteOffset, fb.byteLength)).digest("hex");
}
