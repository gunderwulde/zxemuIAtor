// Carga de ficheros TAP/SNA/Z80 en el núcleo. Puro (sin DOM) para poder testearlo.

export type FileFormat = "tap" | "sna" | "z80";

export interface FileLoader {
  loadTap(d: Uint8Array): number;
  loadSna(d: Uint8Array): number;
  loadZ80(d: Uint8Array): number;
}

export function formatOf(name: string): FileFormat | null {
  const m = /\.(tap|sna|z80)$/i.exec(name);
  return m ? (m[1]!.toLowerCase() as FileFormat) : null;
}

// Códigos de error de zx.h.
const ERRORS: Record<number, string> = {
  [-1]: "longitud imposible para el formato",
  [-2]: "contenido malformado",
  [-3]: "snapshot de un modelo distinto del 48K",
};

export interface LoadResult { ok: boolean; message: string; format: FileFormat | null }

/** Carga un fichero en el núcleo y devuelve un mensaje para el usuario. */
export function loadFile(core: FileLoader, name: string, data: Uint8Array): LoadResult {
  const format = formatOf(name);
  if (!format) return { ok: false, format, message: `«${name}»: formato no reconocido (se admiten .tap, .sna y .z80)` };
  let r: number;
  try {
    r = format === "tap" ? core.loadTap(data) : format === "sna" ? core.loadSna(data) : core.loadZ80(data);
  } catch (e) {
    return { ok: false, format, message: `«${name}»: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (r !== 0) return { ok: false, format, message: `«${name}»: ${ERRORS[r] ?? `error ${r} del núcleo`}` };
  const message = format === "tap"
    ? `Cinta «${name}» insertada. Escribe LOAD "" (J y dos veces SYM+P) y pulsa Enter.`
    : `Snapshot «${name}» cargado.`;
  return { ok: true, format, message };
}
