// CPU-21 · z80test 1.2a de Patrik Rak (EXT, tests/fixtures/z80test) en core-probe.wasm.
// Máquina real con la ROM: se inserta el TAP con zx_load_tap, se teclea LOAD "" y el
// cargador BASIC (src/loader.bas: CLEAR 32767: LOAD "" CODE: RANDOMIZE USR 32768) carga
// y ejecuta el test. El resultado se lee de la pantalla con screenText (OCR con la fuente
// de la ROM).
//
// El programa imprime con RST 10h (src/print.asm), así que al llenarse la pantalla la ROM
// pregunta "scroll?" (ROM 0x0C55 PO-SCR). Se responde con ENTER (cualquier tecla salvo
// N, SPACE o BREAK sigue) y antes se recogen las líneas FAILED visibles.
//
// Por defecto sólo z80doc (unos 17 000 frames, ~4 s); ZX_FULL=1 ejecuta las seis variantes de
// TEST-PLAN CPU-21. z80ccfscr no se ejecuta: es visual, no da resultado.
import { describe, expect, it } from "vitest";
import { KEY, typeKeys } from "../../util/keys";
import { Probe } from "../../util/probe";
import { screenLines } from "../../util/screen";
import { fixture } from "../../util/wasm";

const FULL = process.env.ZX_FULL === "1";
const VARIANTS = FULL ? ["z80doc", "z80full", "z80flags", "z80docflags", "z80ccf", "z80memptr"] : ["z80doc"];
// Tope de frames emulados por variante (10 minutos de Spectrum).
const MAX_FRAMES = 50 * 60 * 10;

interface RakResult { result: string | null; failed: string[]; frames: number; tail: string[] }

async function rak(tap: Uint8Array): Promise<RakResult | { loadError: number }> {
  const p = await Probe.create();
  for (let i = 0; i < 150; i++) p.runFrame(); // arranque de la ROM hasta "© 1982 Sinclair Research Ltd"
  const err = p.loadTap(tap);
  if (err !== 0) return { loadError: err };
  let frames = typeKeys(p, 'LOAD ""\n');
  // Por número de test; una línea leída a mitad de imprimir puede tener glifos "?".
  const failed = new Map<string, string>();
  const collect = (lines: string[]) => {
    for (const l of lines) {
      const m = /^(\d{3}) .*FAILED/.exec(l);
      if (m && (!failed.has(m[1]!) || !l.includes("?"))) failed.set(m[1]!, l.trim());
    }
  };
  let result: string | null = null;
  let lines: string[] = [];
  while (frames < MAX_FRAMES) {
    for (let i = 0; i < 25; i++, frames++) p.runFrame();
    lines = screenLines(p.ram());
    collect(lines);
    // "Result: NNN of NNN tests failed." ocupa dos líneas de 32 columnas.
    const i = lines.findIndex((l) => l.startsWith("Result: "));
    if (i >= 0 && lines.slice(i).some((l) => l.includes("."))) {
      result = (lines[i]! + (lines[i]!.includes(".") ? "" : lines[i + 1]!)).trim();
      break;
    }
    if (lines.some((l) => l.includes("scroll?"))) {
      p.x.zx_key(KEY.ENTER![0], KEY.ENTER![1], 1);
      for (let i = 0; i < 3; i++, frames++) p.runFrame();
      p.x.zx_key(KEY.ENTER![0], KEY.ENTER![1], 0);
      for (let i = 0; i < 3; i++, frames++) p.runFrame();
    }
  }
  return { result, failed: [...failed.values()], frames, tail: lines.filter((l) => l.trim()).slice(-6) };
}

describe("[C1+M1+M3+ROM] CPU-21 z80test (Patrik Rak)", () => {
  for (const name of VARIANTS) {
    const tap = fixture(`z80test/z80test-1.2a/${name}.tap`);
    it.skipIf(!tap)(name, async () => {
      const r = await rak(tap!);
      // La cinta tiene que cargar: un fallo de zx_load_tap es un fallo del test.
      expect("loadError" in r ? r.loadError : 0, `CPU-21 ${name}: zx_load_tap`).toBe(0);
      if ("loadError" in r) return;
      expect(r.result, `sin "Result:" tras ${r.frames} frames; pantalla:\n${r.tail.join("\n")}`).not.toBeNull();
      expect({ result: r.result, failed: r.failed }).toEqual({ result: "Result: all tests passed.", failed: [] });
    }, 600_000);
  }
});
