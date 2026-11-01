// Carga de los .wasm del núcleo y fixtures en los tests (Node).
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Mismo directorio que tools/build-core.mjs (ZX_BUILD_DIR permite uno por agente).
export const WASM_DIR = join(ROOT, process.env.ZX_BUILD_DIR ?? join("build", "wasm"));
export const FIXTURES = join(ROOT, "tests", "fixtures");

export type WasmName = "core" | "core-probe" | "core-test";

export async function instantiate(name: WasmName): Promise<WebAssembly.Instance> {
  const path = join(WASM_DIR, `${name}.wasm`);
  if (!existsSync(path)) throw new Error(`${path} no existe: ejecuta "npm run build:core"`);
  const { instance } = await WebAssembly.instantiate(readFileSync(path), {});
  return instance;
}

export function rom48(): Uint8Array {
  return new Uint8Array(readFileSync(join(ROOT, "rom", "48.rom")));
}

/** Fixture externo; si falta, el test debe saltarse con un aviso (npm run fetch). */
export function fixture(rel: string): Uint8Array | null {
  const p = join(FIXTURES, rel);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
}
