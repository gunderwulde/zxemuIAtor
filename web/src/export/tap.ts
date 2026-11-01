// E1: exportación a .tap de un programa ensamblado, con cargador BASIC. Puro (sin DOM).
//
// FUENTES
// - Formato .tap: cada bloque es [longitud LE de 16 bits][flag][datos…][checksum], donde
//   la longitud cuenta flag + datos + checksum y el checksum es el XOR de flag y datos
//   (World of Spectrum, "TAP format"; Fuse/libspectrum tap.c).
// - Cabecera de la ROM (The Complete Spectrum ROM Disassembly, Logan & O'Hara, SA-BYTES
//   04C2 / LD-BYTES 0556 y la tabla de cabeceras de SAVE-ETC 0605): bloque de flag 00h
//   con 17 bytes = tipo (0 Program, 3 Bytes), nombre (10 caracteres, relleno con
//   espacios), longitud de datos, parámetro 1 y parámetro 2. Para Program: p1 = línea
//   de autoarranque (≥ 32768 = sin autoarranque), p2 = longitud del programa sin
//   variables. Para Bytes: p1 = dirección de carga, p2 = 32768 por convención. El
//   bloque de datos lleva flag FFh.
// - Programa BASIC en memoria (manual del 48K, cap. 24): por línea, número en BIG
//   endian, longitud en LITTLE endian del texto que sigue (incluido el ENTER 0Dh), texto
//   tokenizado y 0Dh. Cada literal numérico va como sus dígitos ASCII seguidos de 0Eh y
//   la forma de 5 bytes; un entero 0..65535 es 00 00 lo hi 00 ("small integer").
// - Tokens (tabla de palabras clave de la ROM en 0095h; RND = A5h): USR C0h, CODE AFh,
//   LOAD EFh, RANDOMIZE F9h, CLEAR FDh. El test los vuelve a sacar de rom/48.rom.
//
// DECISIÓN: un bloque CODE por segmento contiguo, no un único bloque relleno con ceros.
// Un único bloque desde el primer al último byte pisaría todo lo que hay entre medias:
// con un segmento en la pantalla (4000h) y el código en 8000h cubriría las variables del
// sistema y el propio cargador BASIC mientras se ejecuta, y con un segmento en FF00h la
// cinta crecería con kilobytes de ceros. El ensamblador ya junta los tramos que se tocan,
// así que un programa normal sigue siendo un solo bloque. Los bloques van en orden
// DESCENDENTE de dirección: la ROM imprime "Bytes: nombre" en la pantalla al encontrar
// cada cabecera, de modo que un segmento en la pantalla se carga
// el último y nadie lo emborrona (en orden ascendente tests/export/load.test.ts falla).
//
// CLEAR (rutina CLEAR 1EACh, bytes comprobados en rom/48.rom; ver MIN_CODE_GAP): "M RAMTOP no
// good" si n ≤ STKEND + 50 o n > P_RAMT; CLEAR 0 no cambia RAMTOP. Por eso los
// segmentos por debajo de 5C00h (pantalla y búfer de impresora) no cuentan para CLEAR y
// los que caen entre 5C00h y el final del área de BASIC son un error: pisarían las
// variables del sistema o el cargador mientras éste se ejecuta.

import type { AsmSegment } from "../asm";

export interface ExportMessage { severity: "error" | "warning" | "info"; text: string }

// Tokens de la ROM 48K.
export const TOKEN = { USR: 0xc0, CODE: 0xaf, LOAD: 0xef, RANDOMIZE: 0xf9, CLEAR: 0xfd } as const;
const NUMBER_MARK = 0x0e;
const ENTER = 0x0d;
const QUOTE = 0x22;
const COLON = 0x3a;

export const HEADER_FLAG = 0x00;
export const DATA_FLAG = 0xff;
export const TYPE_PROGRAM = 0;
export const TYPE_CODE = 3;
export const LOADER_LINE = 10;

/** PROG con el 48K recién arrancado sin Interface 1 (manual, cap. 25: 23755). */
export const PROG_START = 0x5ccb;
/**
 * Distancia mínima entre STKEND (con el cargador ejecutándose) y el primer byte de
 * código, MEDIDA con rom/48.rom (tests/export/load.test.ts la fija en los dos sentidos).
 * Por debajo, la ROM falla de dos formas: con muy poco hueco CLEAR da "M RAMTOP no good"
 * (exige n > STKEND + 50, LD DE,0032h en 1EC6h); con algo más, LOAD ""CODE da
 * "4 Out of memory", porque reserva 34 bytes para las dos cabeceras en WORKSP y
 * TEST-ROOM (1F05h) exige además 80 bytes libres bajo SP, que CLEAR ha puesto justo bajo
 * la nueva RAMTOP.
 */
export const MIN_CODE_GAP = 152;
/**
 * Por debajo de aquí el código queda muy cerca del área de BASIC: CLEAR lo admite, pero
 * la pila de la máquina (bajo RAMTOP) y el calculador tienen pocos bytes. Valor habitual
 * de los cargadores (≈ 24000).
 */
export const SAFE_CODE_START = 0x5dc0;

/** Literal numérico de BASIC: dígitos, 0Eh y forma entera de 5 bytes (0 ≤ n ≤ 65535). */
export function basicNumber(n: number): number[] {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new RangeError(`número fuera de rango para BASIC: ${n}`);
  return [...Array.from(String(n), (c) => c.charCodeAt(0)), NUMBER_MARK, 0x00, 0x00, n & 0xff, n >> 8, 0x00];
}

/** Una línea de programa: número BE, longitud LE, texto y ENTER. */
export function basicLine(num: number, body: readonly number[]): number[] {
  const len = body.length + 1;
  return [num >> 8, num & 0xff, len & 0xff, len >> 8, ...body, ENTER];
}

/**
 * Cuerpo de la línea 10: `[CLEAR c:] LOAD ""CODE [: LOAD ""CODE…]: RANDOMIZE USR e`.
 * Sin CLEAR si `clear` es null (todos los segmentos están bajo 5C00h).
 */
export function loaderBody(clear: number | null, codeBlocks: number, entry: number): number[] {
  const out: number[] = [];
  if (clear !== null) out.push(TOKEN.CLEAR, ...basicNumber(clear), COLON);
  for (let i = 0; i < codeBlocks; i++) out.push(TOKEN.LOAD, QUOTE, QUOTE, TOKEN.CODE, COLON);
  out.push(TOKEN.RANDOMIZE, TOKEN.USR, ...basicNumber(entry));
  return out;
}

/** Bloque .tap completo: [len16][flag][datos][xor]. */
export function tapBlock(flag: number, data: ArrayLike<number>): number[] {
  let x = flag;
  for (let i = 0; i < data.length; i++) x ^= data[i]!;
  const len = data.length + 2;
  return [len & 0xff, len >> 8, flag, ...Array.from(data), x];
}

/** Nombre de cinta: 10 caracteres ASCII imprimibles, rellenos con espacios. */
export function tapeName(name: string): number[] {
  const clean = Array.from(name, (c) => {
    const k = c.charCodeAt(0);
    return k >= 0x20 && k < 0x7f ? k : 0x3f; // "?" para lo que la ROM no tiene
  }).slice(0, 10);
  while (clean.length < 10) clean.push(0x20);
  return clean;
}

/** Cabecera de 17 bytes de la ROM. */
export function header(type: number, name: string, len: number, p1: number, p2: number): number[] {
  return [type, ...tapeName(name), len & 0xff, len >> 8, p1 & 0xff, p1 >> 8, p2 & 0xff, p2 >> 8];
}

export interface TapExport {
  /** null si hay errores. */
  tap: Uint8Array<ArrayBuffer> | null;
  messages: ExportMessage[];
  /** Valor de CLEAR usado (null: sin CLEAR). */
  clear: number | null;
}

const hex4 = (x: number) => x.toString(16).toUpperCase().padStart(4, "0") + "h";

/**
 * TAP con cargador BASIC autoejecutable (línea 10) y un bloque CODE por segmento.
 * `name` es el nombre de cinta (se recorta a 10 caracteres).
 */
export function buildTap(segments: readonly AsmSegment[], entry: number, name: string): TapExport {
  const messages: ExportMessage[] = [];
  const segs = segments.filter((s) => s.bytes.length > 0);
  if (segs.length === 0) return { tap: null, clear: null, messages: [{ severity: "error", text: "El programa no genera ningún byte." }] };

  const high = segs.filter((s) => s.addr >= 0x5c00);
  const low = high.length ? Math.min(...high.map((s) => s.addr)) : null;
  const clear = low === null ? null : low - 1;
  const program = basicLine(LOADER_LINE, loaderBody(clear, segs.length, entry & 0xffff));
  // Con el cargador ya cargado y ejecutándose: VARS = PROG + programa, 80h de fin de
  // variables, línea de edición vacía (0Dh 80h) y la pila del calculador vacía, así que
  // STKEND = PROG + programa + 3 (comprobado en el test con la propia ROM).
  const stkend = PROG_START + program.length + 3;
  const minCode = stkend + MIN_CODE_GAP;

  for (const s of segs) {
    const end = s.addr + s.bytes.length - 1;
    if (s.addr < 0x4000) {
      messages.push({ severity: "error", text: `El segmento ${hex4(s.addr)}–${hex4(end)} cae en la ROM (0000h–3FFFh): LOAD ""CODE no puede escribirlo.` });
    } else if (s.addr < 0x5c00 && end >= 0x5c00) {
      messages.push({ severity: "error", text: `El segmento ${hex4(s.addr)}–${hex4(end)} entra en las variables del sistema (5C00h): el cargador BASIC dejaría de funcionar.` });
    }
  }
  if (low !== null && low < minCode) {
    messages.push({ severity: "error", text: `El código empieza en ${hex4(low)}, demasiado cerca del área de BASIC: CLEAR ${clear} y LOAD ""CODE fallarían («M RAMTOP no good» o «4 Out of memory»; mínimo ${hex4(minCode)}). Usa un ORG mayor (p. ej. ORG 8000h).` });
  } else if (low !== null && low < SAFE_CODE_START) {
    messages.push({ severity: "warning", text: `El código empieza en ${hex4(low)}, muy cerca del área de BASIC: queda poca pila para la ROM. Se recomienda ORG ≥ ${hex4(SAFE_CODE_START)}.` });
  }
  if (!segs.some((s) => entry >= s.addr && entry < s.addr + s.bytes.length)) {
    messages.push({ severity: "warning", text: `La entrada ${hex4(entry & 0xffff)} no está dentro del código exportado.` });
  }
  if (messages.some((m) => m.severity === "error")) return { tap: null, clear, messages };

  const blocks: number[][] = [
    tapBlock(HEADER_FLAG, header(TYPE_PROGRAM, name, program.length, LOADER_LINE, program.length)),
    tapBlock(DATA_FLAG, program),
  ];
  for (const s of [...segs].sort((a, b) => b.addr - a.addr)) {
    blocks.push(tapBlock(HEADER_FLAG, header(TYPE_CODE, name, s.bytes.length, s.addr, 0x8000)));
    blocks.push(tapBlock(DATA_FLAG, s.bytes));
  }
  const tap = Uint8Array.from(blocks.flat());
  const bytes = segs.reduce((n, s) => n + s.bytes.length, 0);
  messages.push({
    severity: "info",
    text: `TAP generado: cargador BASIC${clear !== null ? ` (CLEAR ${clear})` : ""} y ${segs.length} bloque${segs.length === 1 ? "" : "s"} CODE (${bytes} bytes), RANDOMIZE USR ${entry & 0xffff}. Cárgalo con LOAD "".`,
  });
  return { tap, clear, messages };
}
