// Recursos del IDE (tiles, mapas, sprites, pantallas, textos): pestañas cuyo documento es
// JSON y que se editan con un editor visual. Para el código son ficheros binarios: el
// ensamblador los incluye con INCBIN "nombre.ext". El binario sale de `toBin`, una función
// pura del texto de la pestaña, así que no hay ficheros .bin que mantener al día.
//
// TS puro, sin DOM: el editor visual de cada tipo vive en ui/.

export interface ResourceKind {
  /** Extensión de la pestaña, sin punto y en minúsculas ("scr", "tiles"…). */
  readonly ext: string;
  /** Nombre para menús ("Pantalla", "Tiles"…). */
  readonly label: string;
  /** Documento de una pestaña nueva. */
  template(): string;
  /** null si el documento es válido; si no, el motivo (se muestra en el mensaje de build). */
  check(text: string): string | null;
  /** Bytes que ve INCBIN "nombre.ext". Lanza si el documento no es válido. */
  toBin(text: string): Uint8Array;
  /** Otras salidas binarias: INCBIN "nombre.ext#parte". */
  parts?: Readonly<Record<string, (text: string) => Uint8Array>>;
  /** Constantes para el código: INCLUDE "nombre.ext#inc" (texto ensamblador). `base` es el nombre sin extensión, saneado. */
  inc?(text: string, base: string): string;
}

const kinds = new Map<string, ResourceKind>();

export function registerResource(k: ResourceKind): void {
  if (!/^[a-z][a-z0-9]*$/.test(k.ext)) throw new Error(`extensión de recurso inválida: ${k.ext}`);
  if (kinds.has(k.ext)) throw new Error(`recurso duplicado: .${k.ext}`);
  kinds.set(k.ext, k);
}

/** Sólo para tests: quita un tipo registrado. */
export function unregisterResource(ext: string): void { kinds.delete(ext); }

export function resourceKinds(): ResourceKind[] { return [...kinds.values()]; }

/** Separa "nombre.ext#parte" en [nombre.ext, parte] (parte vacía si no hay). */
export function splitPart(name: string): [string, string] {
  const i = name.lastIndexOf("#");
  return i < 0 ? [name, ""] : [name.slice(0, i), name.slice(i + 1)];
}

/** Tipo de recurso de un nombre de pestaña ("titulo.scr" → .scr), o undefined. */
export function resourceKindOf(name: string): ResourceKind | undefined {
  const m = /\.([A-Za-z][A-Za-z0-9]*)$/.exec(name);
  return m ? kinds.get(m[1]!.toLowerCase()) : undefined;
}
