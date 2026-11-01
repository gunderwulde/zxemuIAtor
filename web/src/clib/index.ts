// L1: librería de C para el Spectrum. Ficheros de la librería (para el includeResolver
// del compilador y el INCLUDE del ensamblador) y ejemplos C precargados.
import spectrumH from "./spectrum.h?raw";
import stringH from "./string.h?raw";
import stdlibH from "./stdlib.h?raw";
import stdioH from "./stdio.h?raw";
import zxgfx from "./zxgfx.asm?raw";
import zxtext from "./zxtext.asm?raw";
import zxinput from "./zxinput.asm?raw";
import zxsound from "./zxsound.asm?raw";
import zxint from "./zxint.asm?raw";
import stringAsm from "./string.asm?raw";
import stdlibAsm from "./stdlib.asm?raw";
import { EXAMPLES as C_EXAMPLES_LIST } from "./examples";

/** Nombre plano (como aparece en #include / #pragma link / INCLUDE) → fuente. */
export const CLIB_FILES: ReadonlyMap<string, string> = new Map([
  ["spectrum.h", spectrumH],
  ["string.h", stringH],
  ["stdlib.h", stdlibH],
  ["stdio.h", stdioH],
  ["zxgfx.asm", zxgfx],
  ["zxtext.asm", zxtext],
  ["zxinput.asm", zxinput],
  ["zxsound.asm", zxsound],
  ["zxint.asm", zxint],
  ["string.asm", stringAsm],
  ["stdlib.asm", stdlibAsm],
]);

/** Para `compile(..., { includeResolver })` y `assemble(..., { include })`. */
export function clibResolve(name: string): string | undefined {
  return CLIB_FILES.get(name.replace(/^.*[\\/]/, ""));
}

export interface CExample { id: string; title: string; source: string }

/** Ejemplos C de menos a más; el primero de DEFAULT_C_EXAMPLE es el visual por defecto. */
export const C_EXAMPLES: readonly CExample[] = C_EXAMPLES_LIST;
export const DEFAULT_C_EXAMPLE: CExample = C_EXAMPLES.find((e) => e.id === "rainbow") ?? C_EXAMPLES[0]!;
