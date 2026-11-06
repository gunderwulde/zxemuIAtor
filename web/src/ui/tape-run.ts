// Arranca una cinta en el emulador como lo haría una persona: reinicia, inserta el .tap y
// teclea LOAD "" + Enter. Puro (sin DOM): trabaja sobre un núcleo mínimo para poder testearlo.
//
// Los frames se ejecutan aquí mismo y de golpe (el arranque de la ROM son ~150 frames, que
// el wasm resuelve en una fracción de segundo); la carga la hace después la trampa de
// LD-BYTES del núcleo, y el bucle normal sigue desde donde queda.

export interface TapeCore {
  x: { zx_reset(): void; zx_key(row: number, bit: number, down: number): void };
  runFrame(): number;
  loadTap(d: Uint8Array): number;
}

const KEY = { J: [6, 3], P: [5, 0], ENTER: [6, 0], SYM: [7, 1] } as const;
const BOOT_FRAMES = 150;

function press(core: TapeCore, keys: readonly (readonly [number, number])[], frames = 4): void {
  for (const [r, b] of keys) core.x.zx_key(r, b, 1);
  for (let i = 0; i < frames; i++) core.runFrame();
  for (const [r, b] of keys) core.x.zx_key(r, b, 0);
  for (let i = 0; i < frames; i++) core.runFrame();
}

/** null si todo fue bien; si no, el motivo. */
export function startTape(core: TapeCore, tap: Uint8Array): string | null {
  core.x.zx_reset();
  for (let i = 0; i < BOOT_FRAMES; i++) core.runFrame();
  const r = core.loadTap(tap);
  if (r !== 0) return `el núcleo rechazó la cinta (código ${r})`;
  press(core, [KEY.J]);                    // LOAD
  press(core, [KEY.SYM, KEY.P]);           // "
  press(core, [KEY.SYM, KEY.P]);           // "
  press(core, [KEY.ENTER]);
  return null;
}
