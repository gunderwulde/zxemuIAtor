// Editores visuales de recursos (DOM). El documento vive en la pestaña (JSON); el editor
// lo lee y lo escribe con `io`, así deshacer, guardado y compilación siguen funcionando
// igual que con el texto. Un tipo de recurso sin editor registrado se edita como texto.
import { registerResource } from "../../res/registry";
import { scrResource } from "../../res/scr";
import { tilesResource } from "../../res/tiles";
import { mapResource } from "../../res/map";
import { tapeResource } from "../../res/tape";
import { createMapEditor } from "./map-editor";
import { createScrEditor } from "./scr-editor";
import { createTilesEditor } from "./tiles-editor";

export interface ResourceIo {
  getText(): string;
  /** Sustituye el documento (una sola transacción: un paso de deshacer). */
  setText(text: string): void;
  /** Mensaje corto para el usuario. */
  say(text: string): void;
  /** Nombres de las pestañas de usuario con esa extensión de recurso ("tiles"…). */
  listTabs(ext: string): string[];
  /** Texto de la pestaña de usuario con ese nombre, o undefined. */
  textOf(name: string): string | undefined;
}

export interface ResourceEditor { destroy(): void }
export type ResourceEditorFactory = (host: HTMLElement, io: ResourceIo, tabName: string) => ResourceEditor;

const editors = new Map<string, ResourceEditorFactory>();

export function registerResourceEditor(ext: string, f: ResourceEditorFactory): void { editors.set(ext, f); }

export function resourceEditorFor(name: string): ResourceEditorFactory | undefined {
  const m = /\.([A-Za-z][A-Za-z0-9]*)$/.exec(name);
  return m ? editors.get(m[1]!.toLowerCase()) : undefined;
}

let done = false;
/** Registra los recursos del IDE (tipos y editores). Idempotente; hay que llamarla antes de crear las pestañas. */
export function registerBuiltinResources(): void {
  if (done) return;
  done = true;
  registerResource(scrResource);
  registerResourceEditor("scr", createScrEditor);
  registerResource(tilesResource);
  registerResourceEditor("tiles", createTilesEditor);
  registerResource(mapResource);
  registerResourceEditor("map", createMapEditor);
  // Manifiesto de cinta: se edita como texto (JSON); la construcción está en ui/tabs/project.ts.
  registerResource(tapeResource);
}
