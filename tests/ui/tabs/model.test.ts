// U1: modelo de pestañas (sin DOM). Esperados escritos a mano a partir de las reglas
// documentadas en web/src/ui/tabs/model.ts (qué se ejecuta, qué se compila, persistencia).
import { describe, expect, it } from "vitest";
import { GEN_NAME, LEGACY_SOURCE_KEY, TABS_KEY, TabsModel, hasMain, isRunnable, kindOf, libTabName, type Prefs } from "../../../web/src/ui/tabs/model";

const DEF = { asm: "; asm por defecto\n", c: "int main(void) { return 0; }\n" };

function prefs(init: Record<string, string> = {}): Prefs & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}
const names = (m: TabsModel) => m.tabs.map((t) => t.name);

describe("tipos de fichero", () => {
  it("por extensión, sin distinguir mayúsculas", () => {
    expect([kindOf("a.asm"), kindOf("B.C"), kindOf("x.h"), kindOf("x.txt"), kindOf("asm")]).toEqual(["asm", "c", "h", null, null]);
  });
  it("hasMain ignora comentarios y cadenas", () => {
    expect(hasMain("int main(void) {}")).toBe(true);
    expect(hasMain("void main (void)\n{")).toBe(true);
    expect(hasMain("/* main() */ int f(void);")).toBe(false);
    expect(hasMain('// main()\nchar *s = "main()";')).toBe(false);
    expect(hasMain("int domain(int x);")).toBe(false);
  });
});

describe("primera carga y migración", () => {
  it("sin nada guardado: main.asm (activa y principal) y main.c", () => {
    const m = TabsModel.load(prefs(), DEF);
    expect(names(m)).toEqual(["main.asm", "main.c"]);
    expect(m.active!.name).toBe("main.asm");
    expect(m.main!.name).toBe("main.asm");
    expect(m.find("main.asm")!.text).toBe(DEF.asm);
    expect(m.find("main.c")!.text).toBe(DEF.c);
  });

  it("migra el fuente del editor de I1 a main.asm", () => {
    const m = TabsModel.load(prefs({ [LEGACY_SOURCE_KEY]: "  org 9000h\n  ret\n" }), DEF);
    expect(names(m)).toEqual(["main.asm", "main.c"]);
    expect(m.find("main.asm")!.text).toBe("  org 9000h\n  ret\n");
    expect(m.active!.name).toBe("main.asm");
  });

  it("lo guardado por U1 manda sobre el fuente de I1", () => {
    const p = prefs({ [LEGACY_SOURCE_KEY]: "viejo" });
    const a = TabsModel.load(p, DEF);
    a.add("util.h", "#define N 3\n");
    a.save(p);
    const b = TabsModel.load(p, DEF);
    expect(names(b)).toEqual(["main.asm", "util.h", "main.c"]);
    expect(b.find("main.asm")!.text).toBe("viejo");
  });

  it("JSON corrupto o sin pestañas válidas: como si no hubiera nada", () => {
    expect(names(TabsModel.load(prefs({ [TABS_KEY]: "{no es json" }), DEF))).toEqual(["main.asm", "main.c"]);
    expect(names(TabsModel.load(prefs({ [TABS_KEY]: '{"v":1,"tabs":[{"name":"a.txt","text":""}],"active":"a.txt","main":null}' }), DEF))).toEqual(["main.asm", "main.c"]);
  });
});

describe("persistencia", () => {
  it("guarda orden, textos, activa y principal; no guarda las de sólo lectura", () => {
    const p = prefs();
    const m = TabsModel.initial("A", "int main(){}");
    const h = m.add("defs.h", "H", 1);
    m.addReadOnly(GEN_NAME, "generado", "gen");
    m.addReadOnly(libTabName("spectrum.h"), "lib", "lib");
    m.setActive(h.id);
    m.setMain(m.find("main.c")!.id);
    m.save(p);
    expect(JSON.parse(p.data.get(TABS_KEY)!)).toEqual({
      v: 1,
      tabs: [{ name: "main.asm", text: "A" }, { name: "defs.h", text: "H" }, { name: "main.c", text: "int main(){}" }],
      active: "defs.h",
      main: "main.c",
    });
    const r = TabsModel.load(p, DEF);
    expect(names(r)).toEqual(["main.asm", "defs.h", "main.c"]);
    expect(r.active!.name).toBe("defs.h");
    expect(r.main!.name).toBe("main.c");
  });

  it("si la activa era de sólo lectura se guarda la primera de usuario", () => {
    const m = TabsModel.initial("A", "C");
    m.setActive(m.addReadOnly(GEN_NAME, "x", "gen").id);
    expect(JSON.parse(m.serialize()).active).toBe("main.asm");
  });
});

describe("crear, renombrar, cerrar, reordenar", () => {
  it("crear detrás de la activa; nombres libres", () => {
    const m = TabsModel.initial("A", "C");
    expect(m.freeName("nuevo", "c")).toBe("nuevo.c");
    m.add("nuevo.c", "");
    expect(names(m)).toEqual(["main.asm", "nuevo.c", "main.c"]);
    expect(m.freeName("nuevo", "c")).toBe("nuevo2.c");
    expect(m.freeName("main", "asm")).toBe("main2.asm");
    expect(() => m.add("MAIN.C", "")).toThrow(/Ya hay/);
  });

  it("nombres no válidos", () => {
    const m = TabsModel.initial("A", "C");
    expect(m.checkName("x.txt")).toMatch(/\.asm, \.c o \.h/);
    expect(m.checkName("")).toMatch(/vacío/);
    expect(m.checkName(" a.c")).toMatch(/espacio/);
    expect(m.checkName("dir/a.c")).toMatch(/no puede llevar/);
    expect(m.checkName("<spectrum.h>")).toMatch(/no puede llevar/);
    expect(m.checkName("Main.asm")).toMatch(/Ya hay una pestaña «main.asm»/);
    expect(m.checkName("Main.asm", m.find("main.asm")!.id)).toBeNull(); // sí cambiar mayúsculas de sí misma
  });

  it("renombrar; las de sólo lectura no", () => {
    const m = TabsModel.initial("A", "C");
    const c = m.find("main.c")!;
    expect(m.rename(c.id, "juego.c")).toBeNull();
    expect(names(m)).toEqual(["main.asm", "juego.c"]);
    expect(m.rename(c.id, "main.asm")).toMatch(/Ya hay/);
    const g = m.addReadOnly(GEN_NAME, "", "gen");
    expect(m.rename(g.id, "x.asm")).toMatch(/no se puede renombrar/);
  });

  it("renombrar la principal a .h la deja de ser", () => {
    const m = TabsModel.initial("A", "int main(){}");
    const c = m.find("main.c")!;
    m.setMain(c.id);
    m.rename(c.id, "main.h");
    expect(m.main!.name).toBe("main.asm");
  });

  it("cerrar: la activa pasa a la derecha (o a la izquierda); la principal, a la primera ejecutable", () => {
    const m = TabsModel.initial("A", "int main(){}");
    const b = m.add("b.h", "", 1);
    m.setActive(b.id);
    m.close(b.id);
    expect(names(m)).toEqual(["main.asm", "main.c"]);
    expect(m.active!.name).toBe("main.c");
    m.close(m.find("main.c")!.id);
    expect(m.active!.name).toBe("main.asm");
    const x = m.add("x.c", "int main(){}");
    m.setActive(x.id);
    m.setMain(x.id);
    m.close(x.id);
    expect(m.active!.name).toBe("main.asm");
    expect(m.main!.name).toBe("main.asm");
  });

  it("la última pestaña de usuario no se quita: se vacía", () => {
    const m = TabsModel.initial("A", "C");
    m.close(m.find("main.c")!.id);
    m.addReadOnly(GEN_NAME, "", "gen");
    m.close(m.find("main.asm")!.id);
    expect(names(m)).toEqual(["main.asm", GEN_NAME]);
    expect(m.find("main.asm")!.text).toBe("");
  });

  it("reordenar recorta al rango", () => {
    const m = TabsModel.initial("A", "C");
    m.add("x.h", "", 2);
    m.move(m.find("main.asm")!.id, 99);
    expect(names(m)).toEqual(["main.c", "x.h", "main.asm"]);
    m.move(m.find("x.h")!.id, -5);
    expect(names(m)).toEqual(["x.h", "main.c", "main.asm"]);
    m.move(m.find("main.c")!.id, 2);
    expect(names(m)).toEqual(["x.h", "main.asm", "main.c"]);
  });

  it("addReadOnly reutiliza la pestaña y cambia su texto", () => {
    const m = TabsModel.initial("A", "C");
    const a = m.addReadOnly(GEN_NAME, "uno", "gen");
    const b = m.addReadOnly(GEN_NAME, "dos", "gen");
    expect(b).toBe(a);
    expect(b.text).toBe("dos");
    expect(m.tabs.length).toBe(3);
  });
});

describe("qué se ejecuta y qué se compila", () => {
  it("la activa si es .asm o .c con main; si no, la principal", () => {
    const m = TabsModel.initial("A", "int main(void){}");
    const c = m.find("main.c")!;
    const h = m.add("defs.h", "#define X 1");
    const mod = m.add("util.c", "int twice(int x) { return 2 * x; }");
    const g = m.addReadOnly(GEN_NAME, "", "gen");
    expect([isRunnable(c), isRunnable(h), isRunnable(mod), isRunnable(g)]).toEqual([true, false, false, false]);
    m.setActive(c.id);
    expect(m.runTarget()!.name).toBe("main.c");
    m.setActive(h.id);
    expect(m.runTarget()!.name).toBe("main.asm"); // principal todavía main.asm
    m.setMain(c.id);
    for (const t of [h, mod, g]) { m.setActive(t.id); expect(m.runTarget()!.name).toBe("main.c"); }
    m.setMain(g.id); // una de sólo lectura no puede ser principal
    expect(m.main!.name).toBe("main.c");
  });

  it("cFiles: el .c que se ejecuta, los .h y los .c sin main; no los otros programas", () => {
    const m = TabsModel.initial("A", "int main(void){}");
    m.add("defs.h", "H");
    m.add("util.c", "int f(void){return 1;}");
    m.add("otro.c", "void main(void){}");
    m.addReadOnly(GEN_NAME, "", "gen");
    expect([...m.cFiles(m.find("main.c")!).keys()].sort()).toEqual(["defs.h", "main.c", "util.c"]);
    expect([...m.cFiles(m.find("otro.c")!).keys()].sort()).toEqual(["defs.h", "otro.c", "util.c"]);
  });

  it("userText para INCLUDE: por nombre, sin ruta ni mayúsculas, sólo de usuario", () => {
    const m = TabsModel.initial("A", "C");
    m.add("Lib.asm", "nop");
    m.addReadOnly(libTabName("zxgfx.asm"), "x", "lib");
    expect(m.userText("lib.asm")).toBe("nop");
    expect(m.userText("sub/LIB.ASM")).toBe("nop");
    expect(m.userText("<zxgfx.asm>")).toBeUndefined();
    expect(m.userText("nada.asm")).toBeUndefined();
  });
});
