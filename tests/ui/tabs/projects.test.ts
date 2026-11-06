// Proyectos como espacio de trabajo: ejemplos con manifiesto y .zxproj.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerResource, unregisterResource } from "../../../web/src/res/registry";
import { scrResource } from "../../../web/src/res/scr";
import { tilesResource } from "../../../web/src/res/tiles";
import { tapeResource } from "../../../web/src/res/tape";
import { parseProject, projectDirs, projectExamples, projectWorkspace } from "../../../web/src/ui/tabs/projects";
import { ROOT } from "../../util/wasm";

beforeAll(() => { registerResource(scrResource); registerResource(tilesResource); registerResource(tapeResource); });
afterAll(() => { unregisterResource("scr"); unregisterResource("tiles"); unregisterResource("tape"); });

const man = (extra = {}) => JSON.stringify({ name: "x", title: "Ejemplo X", main: "a.asm", files: ["a.asm", "b.asm"], ...extra });

describe("projectExamples / projectWorkspace", () => {
  it("lista los ejemplos por id con su título", () => {
    const list = projectExamples({ "./examples/zeta/project.json": man({ title: "Z" }), "./examples/alfa/project.json": man({ title: "A" }), "./examples/alfa/a.asm": "" });
    expect(list).toEqual([{ id: "alfa", title: "A" }, { id: "zeta", title: "Z" }]);
  });

  it("monta el espacio de trabajo en el orden del manifiesto, con principal y activa", () => {
    const ws = projectWorkspace("x", {
      "./examples/x/project.json": man({ active: "b.asm" }), "./examples/x/a.asm": " nop", "./examples/x/b.asm": " ret",
    });
    const m = parseProject(ws)!;
    expect(m.user.map((t) => t.name)).toEqual(["a.asm", "b.asm"]);
    expect(m.main?.name).toBe("a.asm");
    expect(m.active?.name).toBe("b.asm");
  });

  it("falla con el nombre del fichero que falta", () => {
    expect(() => projectWorkspace("x", { "./examples/x/project.json": man() })).toThrow("falta a.asm");
  });

  it("parseProject rechaza lo que no es un espacio de trabajo", () => {
    expect(parseProject("no es json")).toBeNull();
    expect(parseProject(JSON.stringify({ v: 2, tabs: [] }))).toBeNull();
  });

  it("una entrada otro/fichero toma el fichero de otro ejemplo", () => {
    const m = man({ files: ["a.asm", "otro/b.asm"] });
    const files = { "./examples/x/project.json": m, "./examples/x/a.asm": " nop", "./examples/otro/b.asm": " ret" };
    expect(projectDirs("x", m)).toEqual(["x", "otro"]);
    expect(parseProject(projectWorkspace("x", files))!.user.map((t) => t.name)).toEqual(["a.asm", "b.asm"]);
    expect(() => projectWorkspace("x", { ...files, "./examples/otro/b.asm": undefined as unknown as string })).toThrow("falta otro/b.asm");
  });

  it("todos los ejemplos del repositorio se montan completos", () => {
    const base = join(ROOT, "web", "src", "examples");
    const files: Record<string, string> = {};
    for (const id of readdirSync(base)) for (const n of readdirSync(join(base, id))) files[`./examples/${id}/${n}`] = readFileSync(join(base, id, n), "utf8");
    for (const id of readdirSync(base)) {
      const own = readdirSync(join(base, id)).filter((n) => n !== "project.json");
      const m = parseProject(projectWorkspace(id, files))!;
      expect(m, id).not.toBeNull();
      const listed = (JSON.parse(files[`./examples/${id}/project.json`]!) as { files: string[] }).files;
      expect(m.user.length, id).toBe(listed.length);
      // Todo fichero propio está en la lista (los compartidos de otros ejemplos son opcionales).
      expect(own.filter((n) => !listed.includes(n)), id).toEqual([]);
    }
  });
});
