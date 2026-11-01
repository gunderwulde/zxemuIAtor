// Teclado PC → matriz 8×5 del Spectrum (docs/zx48-hardware.md §6).
//
// Una tecla del Spectrum se codifica como row*5 + bit (0..39). La matriz física la modela
// el núcleo (ghosting incluido); aquí sólo se decide qué teclas de la matriz están
// pulsadas en cada momento.
//
// Reglas:
//  - Teclas físicas (letras, dígitos, Enter, Espacio, modificadores) por KeyboardEvent.code.
//  - Signos por KeyboardEvent.key, porque dependen de la distribución del teclado PC: el
//    "!" se escribe con Shift+1 en ANSI pero el Spectrum lo quiere como SYM+1. Por eso un
//    signo enmascara el CAPS SHIFT que aporta la tecla Shift del PC mientras está pulsado.
//  - Cada tecla PC recuerda la combinación con la que se pulsó y suelta exactamente esa
//    (aunque al soltarla .key haya cambiado). La matriz es un recuento por tecla lógica,
//    así que soltar Backspace (CAPS+0) no suelta un CAPS que siga pulsado por Shift.

export const KEY_COUNT = 40;
export const k = (row: number, bit: number): number => row * 5 + bit;

export const CAPS = k(0, 0);
export const SYM = k(7, 1);
export const ENTER = k(6, 0);
export const SPACE = k(7, 0);

// Filas de la tabla de §6, en orden de bit.
const ROWS = [
  [-1, "Z", "X", "C", "V"],          // 0xFEFE (bit 0 = CAPS SHIFT)
  ["A", "S", "D", "F", "G"],         // 0xFDFE
  ["Q", "W", "E", "R", "T"],         // 0xFBFE
  ["1", "2", "3", "4", "5"],         // 0xF7FE
  ["0", "9", "8", "7", "6"],         // 0xEFFE
  ["P", "O", "I", "U", "Y"],         // 0xDFFE
  [-1, "L", "K", "J", "H"],          // 0xBFFE (bit 0 = ENTER)
  [-1, -1, "M", "N", "B"],           // 0x7FFE (SPACE, SYM SHIFT)
] as const;

/** Letra o dígito del Spectrum → tecla de la matriz. */
export const CHAR_KEY: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = {};
  ROWS.forEach((r, row) => r.forEach((c, bit) => { if (c !== -1) m[c] = k(row, bit); }));
  return m;
})();

// Signos que el 48K escribe con SYMBOL SHIFT + tecla (serigrafía roja del teclado).
// Los de modo extendido (~ | \ { } [ ]) no se mapean: requieren CAPS+SYM y luego tecla.
export const SYM_CHARS: Readonly<Record<string, string>> = {
  "!": "1", "@": "2", "#": "3", "$": "4", "%": "5",
  "&": "6", "'": "7", "(": "8", ")": "9", "_": "0",
  "<": "R", ">": "T",
  '"': "P", ";": "O",
  "^": "H", "-": "J", "+": "K", "=": "L",
  ":": "Z", "£": "X", "?": "C", "/": "V",
  "*": "B", ",": "N", ".": "M",
};

// Teclas especiales por código físico.
const SPECIAL: Readonly<Record<string, readonly number[]>> = {
  Enter: [ENTER], NumpadEnter: [ENTER], Space: [SPACE],
  ControlLeft: [SYM], ControlRight: [SYM], AltRight: [SYM],
  Backspace: [CAPS, CHAR_KEY["0"]!],      // DELETE
  ArrowLeft: [CAPS, CHAR_KEY["5"]!],
  ArrowDown: [CAPS, CHAR_KEY["6"]!],
  ArrowUp: [CAPS, CHAR_KEY["7"]!],
  ArrowRight: [CAPS, CHAR_KEY["8"]!],
  Escape: [CAPS, SPACE],                  // BREAK
};

export interface Mapping {
  /** Teclas de la matriz que pulsa. */
  keys: readonly number[];
  /** Es la tecla Shift del PC: aporta CAPS SHIFT salvo que lo enmascare un signo. */
  shift?: boolean;
  /** Viene de .key (signo o dígito ya resuelto por la distribución): enmascara el Shift. */
  char?: boolean;
}

/** Tabla de mapeo pura: (code, key) del KeyboardEvent → combinación, o null si no aplica. */
export function mapKey(code: string, key: string): Mapping | null {
  if (code === "ShiftLeft" || code === "ShiftRight") return { keys: [CAPS], shift: true };
  const sp = SPECIAL[code];
  if (sp) return { keys: sp };
  // Letras: siempre la tecla física, y Shift = CAPS SHIFT da mayúscula como en el 48K.
  if (code.length === 4 && code.startsWith("Key")) {
    const c = CHAR_KEY[code[3]!];
    return c === undefined ? null : { keys: [c] };
  }
  const sym = SYM_CHARS[key];
  if (sym !== undefined) return { keys: [SYM, CHAR_KEY[sym]!], char: true };
  if (key.length === 1 && key >= "0" && key <= "9") return { keys: [CHAR_KEY[key]!], char: true };
  // Fila de dígitos con un carácter sin equivalente (p. ej. "é" en AZERTY): tecla física.
  if (code.length === 6 && code.startsWith("Digit")) {
    const c = CHAR_KEY[code[5]!];
    return c === undefined ? null : { keys: [c] };
  }
  return null;
}

/** Estado del teclado: recuento por tecla lógica y envío de los cambios al núcleo. */
export class KeyState {
  private held = new Map<string, Mapping>();
  private count = new Uint8Array(KEY_COUNT);
  private sent = new Uint8Array(KEY_COUNT);
  private shifts = 0;
  private chars = 0;

  constructor(private sink: (row: number, bit: number, down: boolean) => void) {}

  /** Devuelve true si la tecla pertenece al Spectrum (el llamador hace preventDefault). */
  down(code: string, key: string): boolean {
    if (this.held.has(code)) return true; // autorrepetición del PC: el Spectrum repite solo
    const m = mapKey(code, key);
    if (!m) return false;
    this.held.set(code, m);
    if (m.shift) this.shifts++;
    else for (const x of m.keys) this.count[x]!++;
    if (m.char) this.chars++;
    this.flush();
    return true;
  }

  up(code: string): boolean {
    const m = this.held.get(code);
    if (!m) return false;
    this.held.delete(code);
    if (m.shift) this.shifts--;
    else for (const x of m.keys) this.count[x]!--;
    if (m.char) this.chars--;
    this.flush();
    return true;
  }

  releaseAll(): void {
    this.held.clear();
    this.count.fill(0);
    this.shifts = 0;
    this.chars = 0;
    this.flush();
  }

  /** ¿Está pulsada la tecla lógica x tal como la ve el Spectrum? */
  isDown(x: number): boolean { return this.sent[x] === 1; }

  private flush(): void {
    for (let x = 0; x < KEY_COUNT; x++) {
      let on = this.count[x]! > 0;
      if (x === CAPS && this.shifts > 0 && this.chars === 0) on = true;
      const v = on ? 1 : 0;
      if (v !== this.sent[x]) {
        this.sent[x] = v;
        this.sink((x / 5) | 0, x % 5, on);
      }
    }
  }
}

/** Engancha el teclado al canvas: sólo con el foco en él llegan teclas al Spectrum. */
export function attachKeyboard(el: HTMLElement, keys: KeyState): void {
  el.addEventListener("keydown", (e) => {
    if (e.metaKey) return; // atajos del sistema (Cmd en macOS)
    if (keys.down(e.code, e.key)) e.preventDefault();
  });
  el.addEventListener("keyup", (e) => {
    if (keys.up(e.code)) e.preventDefault();
  });
  el.addEventListener("blur", () => keys.releaseAll());
}
