// Proyectos como conjunto de pestañas: ejemplos que viajan con la aplicación (web/src/examples/<id>/)
// y ficheros .zxproj. Un .zxproj es exactamente el JSON con que se guarda el espacio de trabajo
// (TabsModel.serialize), así que importar es validarlo con TabsModel.parse y exportar es serializar.
import { TabsModel } from "./model";

/** Cabecera de un ejemplo: web/src/examples/<id>/project.json. */
interface ProjectManifest { name: string; title: string; main: string; active?: string; files: string[] }

export interface ProjectExample { id: string; title: string }

/** Ejemplos disponibles a partir de sus manifiestos (ruta de project.json → contenido). */
export function projectExamples(manifests: Record<string, string>): ProjectExample[] {
  const out: ProjectExample[] = [];
  for (const [path, text] of Object.entries(manifests)) {
    const m = /\/([^/]+)\/project\.json$/.exec(path);
    if (m) out.push({ id: m[1]!, title: (JSON.parse(text) as ProjectManifest).title });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Directorios de ejemplos que hacen falta para abrir `id`: el suyo y los de las entradas
 * "otro/fichero" de su manifiesto (ficheros compartidos con otro ejemplo).
 */
export function projectDirs(id: string, manifestText: string): string[] {
  const man = JSON.parse(manifestText) as ProjectManifest;
  return [...new Set([id, ...man.files.filter((e) => e.includes("/")).map((e) => e.slice(0, e.indexOf("/")))])];
}

/**
 * Espacio de trabajo (formato de TabsModel.serialize) de un ejemplo: `files` es ruta → contenido
 * de los ficheros de su directorio (y de los compartidos), project.json incluido. Una entrada
 * "otro/fichero" del manifiesto es la pestaña "fichero" tomada del ejemplo "otro". Lanza si falta alguno.
 */
export function projectWorkspace(id: string, files: Record<string, string>): string {
  const key = Object.keys(files).find((k) => k.endsWith(`/${id}/project.json`));
  if (!key) throw new Error(`Ejemplo ${id}: falta project.json`);
  const root = key.slice(0, key.length - `${id}/project.json`.length);
  const man = JSON.parse(files[key]!) as ProjectManifest;
  const tabs = man.files.map((entry) => {
    const text = files[root + (entry.includes("/") ? entry : `${id}/${entry}`)];
    if (text === undefined) throw new Error(`Ejemplo ${id}: falta ${entry}`);
    return { name: entry.slice(entry.lastIndexOf("/") + 1), text };
  });
  return JSON.stringify({ v: 1, tabs, active: man.active ?? man.main, main: man.main });
}

/** El modelo de un .zxproj, o null si no es un espacio de trabajo válido. */
export function parseProject(raw: string): TabsModel | null { return TabsModel.parse(raw); }
