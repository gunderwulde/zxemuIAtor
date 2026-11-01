// U1: modelo de pestañas del editor, sin DOM. Cada pestaña es un fichero (.asm, .c o .h)
// del "proyecto"; además hay pestañas de sólo lectura que no se guardan: el ensamblador
// generado por el compilador de C y los ficheros de la librería.
//
// QUÉ SE EJECUTA (Ctrl+Enter, Ejecutar, Depurar, Exportar TAP): la pestaña activa si se
// puede ejecutar —un .asm, o un .c que define main()—; si no (un .h, un .c sin main, el
// generado o la librería), la principal. Ejecutar una pestaña la hace principal (▶ en su
// pestaña). Así, depurar un programa que salta a funciones de otro .c y pulsar Ctrl+Enter
// desde ese .c vuelve a ejecutar el programa, no el módulo.
//
// Un programa C se compila con: el .c que se ejecuta, todos los .h y los .c sin main
// (módulos). Los .c con main de otras pestañas (ejemplos abiertos, otros programas) no
// entran, así que no chocan entre sí.

export type TabKind = "asm" | "c" | "h";
export type ReadOnlyKind = "gen" | "lib";

export interface Tab {
  readonly id: number;
  name: string;
  text: string;
  /** Sólo lectura (no se guarda): ensamblador generado o fichero de la librería. */
  readonly ro?: ReadOnlyKind;
}

/** Nombre de la pestaña del ensamblador generado por el compilador de C. */
export const GEN_NAME = "(generado).asm";
/** Pestañas de la librería: "<spectrum.h>" (no puede chocar con un nombre de usuario). */
export const libTabName = (file: string) => `<${file}>`;

export const TABS_KEY = "zx.tabs";
/** Clave del fuente único del editor de I1 (se migra a "main.asm"). */
export const LEGACY_SOURCE_KEY = "zx.editor.source";

export interface Prefs {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function kindOf(name: string): TabKind | null {
  const m = /\.(asm|c|h)$/i.exec(name);
  return m ? (m[1]!.toLowerCase() as TabKind) : null;
}

/** Lenguaje de resaltado de una pestaña (las de la librería y la generada incluidas). */
export function langOf(tab: Tab): "z80" | "c" {
  const n = tab.ro === "lib" ? tab.name.slice(1, -1) : tab.name;
  return kindOf(n) === "asm" ? "z80" : "c";
}

/** Quita comentarios, cadenas y caracteres de un fuente C (para buscar main). */
function stripC(src: string): string {
  return src.replace(/\/\*[\s\S]*?(\*\/|$)|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/g, " ");
}

/** El fuente C define (o declara) main: es un programa, no un módulo. */
export function hasMain(src: string): boolean {
  return /\bmain\s*\(/.test(stripC(src));
}

export function isRunnable(tab: Tab): boolean {
  if (tab.ro) return false;
  const k = kindOf(tab.name);
  return k === "asm" || (k === "c" && hasMain(tab.text));
}

interface Saved { v: 1; tabs: { name: string; text: string }[]; active: string; main: string | null }

export class TabsModel {
  readonly tabs: Tab[] = [];
  activeId = -1;
  /** Principal: lo que se ejecuta si la activa no se puede ejecutar. */
  mainId: number | null = null;
  private nextId = 1;

  get(id: number): Tab | undefined { return this.tabs.find((t) => t.id === id); }
  find(name: string): Tab | undefined {
    const l = name.toLowerCase();
    return this.tabs.find((t) => t.name.toLowerCase() === l);
  }
  get active(): Tab | undefined { return this.get(this.activeId); }
  get main(): Tab | undefined { return this.mainId === null ? undefined : this.get(this.mainId); }
  /** Pestañas de usuario (las que se guardan y se compilan). */
  get user(): Tab[] { return this.tabs.filter((t) => !t.ro); }
  indexOf(id: number): number { return this.tabs.findIndex((t) => t.id === id); }

  /** null si `name` vale para la pestaña `self` (o una nueva); si no, el motivo. */
  checkName(name: string, self?: number): string | null {
    if (name.trim() !== name || name === "") return "El nombre no puede estar vacío ni empezar o acabar en espacio.";
    if (/[\\/<>:"|?*\u0000-\u001f]/.test(name)) return "El nombre no puede llevar \\ / < > : \" | ? * ni caracteres de control.";
    if (!kindOf(name)) return "El nombre debe acabar en .asm, .c o .h.";
    if (name.length > 64) return "El nombre es demasiado largo (máximo 64 caracteres).";
    const other = this.find(name);
    if (other && other.id !== self) return `Ya hay una pestaña «${other.name}».`;
    return null;
  }

  /** Nombre libre "base.ext", "base2.ext", "base3.ext"… */
  freeName(base: string, ext: TabKind): string {
    for (let i = 1; ; i++) {
      const n = `${base}${i === 1 ? "" : i}.${ext}`;
      if (!this.find(n)) return n;
    }
  }

  /** Crea una pestaña de usuario (detrás de la activa; no la activa). Lanza si el nombre no vale. */
  add(name: string, text: string, at = this.indexOf(this.activeId) + 1 || this.tabs.length): Tab {
    const err = this.checkName(name);
    if (err) throw new Error(err);
    return this.insert({ id: this.nextId++, name, text }, at);
  }

  /** Pestaña de sólo lectura; si ya existe una con ese nombre, la reutiliza (texto nuevo). */
  addReadOnly(name: string, text: string, ro: ReadOnlyKind): Tab {
    const old = this.find(name);
    if (old?.ro === ro) { old.text = text; return old; }
    return this.insert({ id: this.nextId++, name, text, ro }, this.tabs.length);
  }

  private insert(tab: Tab, at: number): Tab {
    this.tabs.splice(Math.max(0, Math.min(at, this.tabs.length)), 0, tab);
    return tab;
  }

  rename(id: number, name: string): string | null {
    const tab = this.get(id);
    if (!tab || tab.ro) return "Esta pestaña no se puede renombrar.";
    const err = this.checkName(name, id);
    if (err) return err;
    tab.name = name;
    if (this.mainId === id && !isRunnable(tab)) this.mainId = this.pickMain();
    return null;
  }

  /**
   * Cierra la pestaña. La activa pasa a la de su derecha (o izquierda). Si era la
   * principal, la principal pasa a la primera ejecutable. Siempre queda al menos una
   * pestaña de usuario: cerrar la última la deja vacía en vez de quitarla.
   */
  close(id: number): void {
    const i = this.indexOf(id);
    if (i < 0) return;
    const tab = this.tabs[i]!;
    if (!tab.ro && this.user.length === 1) { tab.text = ""; return; }
    this.tabs.splice(i, 1);
    if (this.activeId === id) this.activeId = (this.tabs[i] ?? this.tabs[i - 1])!.id;
    if (this.mainId === id) this.mainId = this.pickMain();
  }

  /** Mueve la pestaña a la posición `to` (índice final, se recorta al rango). */
  move(id: number, to: number): void {
    const i = this.indexOf(id);
    if (i < 0) return;
    const [tab] = this.tabs.splice(i, 1);
    this.tabs.splice(Math.max(0, Math.min(to, this.tabs.length)), 0, tab!);
  }

  setActive(id: number): void { if (this.get(id)) this.activeId = id; }

  /** La activa si se puede ejecutar; si no, la principal (si aún se puede). */
  runTarget(): Tab | undefined {
    const a = this.active;
    if (a && isRunnable(a)) return a;
    const m = this.main;
    return m && isRunnable(m) ? m : undefined;
  }

  /** Marca `id` como principal (al ejecutarla). */
  setMain(id: number): void { if (this.get(id) && !this.get(id)!.ro) this.mainId = id; }

  private pickMain(): number | null { return this.tabs.find(isRunnable)?.id ?? null; }

  /**
   * Ficheros de usuario para compilar el programa C cuyo main está en `main`: ése, todos
   * los .h y los .c sin main.
   */
  cFiles(main: Tab): Map<string, string> {
    const files = new Map<string, string>();
    for (const t of this.user) {
      const k = kindOf(t.name);
      if (t === main || k === "h" || (k === "c" && !hasMain(t.text))) files.set(t.name, t.text);
    }
    return files;
  }

  /** Para INCLUDE del ensamblador: pestaña de usuario por nombre (sin distinguir mayúsculas). */
  userText(name: string): string | undefined {
    const t = this.find(name.replace(/^.*[\\/]/, ""));
    return t && !t.ro ? t.text : undefined;
  }

  // ---- Persistencia ----

  serialize(): string {
    const s: Saved = {
      v: 1,
      tabs: this.user.map((t) => ({ name: t.name, text: t.text })),
      active: this.active && !this.active.ro ? this.active.name : this.user[0]?.name ?? "",
      main: this.main?.name ?? null,
    };
    return JSON.stringify(s);
  }

  save(prefs: Prefs): void { prefs.set(TABS_KEY, this.serialize()); }

  /**
   * Carga lo guardado. Sin nada propio: si hay fuente del editor de I1 se migra a
   * "main.asm" (más "main.c" con el ejemplo C); si no, las dos pestañas por defecto.
   * Un JSON corrupto cuenta como "nada guardado" (salvo que haya fuente de I1).
   */
  static load(prefs: Prefs, defaults: { asm: string; c: string }): TabsModel {
    const raw = prefs.get(TABS_KEY);
    if (raw !== null) {
      const m = TabsModel.parse(raw);
      if (m) return m;
    }
    const legacy = prefs.get(LEGACY_SOURCE_KEY);
    return TabsModel.initial(legacy ?? defaults.asm, defaults.c);
  }

  /** main.asm y main.c; activa y principal main.asm. */
  static initial(asm: string, c: string): TabsModel {
    const m = new TabsModel();
    const a = m.add("main.asm", asm);
    m.add("main.c", c);
    m.activeId = a.id;
    m.mainId = a.id;
    return m;
  }

  static parse(raw: string): TabsModel | null {
    let s: Saved;
    try { s = JSON.parse(raw) as Saved; } catch { return null; }
    if (!s || s.v !== 1 || !Array.isArray(s.tabs)) return null;
    const m = new TabsModel();
    for (const t of s.tabs) {
      if (typeof t?.name !== "string" || typeof t.text !== "string") continue;
      if (m.checkName(t.name) !== null) continue; // nombre inválido o repetido: se descarta
      m.insert({ id: m.nextId++, name: t.name, text: t.text }, m.tabs.length);
    }
    if (m.tabs.length === 0) return null;
    m.activeId = (m.find(String(s.active)) ?? m.tabs[0]!).id;
    const main = typeof s.main === "string" ? m.find(s.main) : undefined;
    m.mainId = main && isRunnable(main) ? main.id : m.pickMain();
    return m;
  }
}
