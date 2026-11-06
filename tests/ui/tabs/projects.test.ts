// Proyectos como espacio de trabajo: ejemplos con manifiesto y .zxproj.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerResource, unregisterResource } from "../../../web/src/res/registry";
import { scrResource } from "../../../web/src/res/scr";
import { tilesResource } from "../../../web/src/res/tiles";
import { tapeResource } from "../../../web/src/res/tape";
import { parseProject, projectExamples, projectWorkspace } from "../../../web/src/ui/tabs/projects";
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

  it("todos los ejemplos del repositorio se montan completos", () => {
    const base = join(ROOT, "web", "src", "examples");
    for (const id of readdirSync(base)) {
      const files: Record<string, string> = {};
      for (const n of readdirSync(join(base, id))) files[`./examples/${id}/${n}`] = readFileSync(join(base, id, n), "utf8");
      const m = parseProject(projectWorkspace(id, files))!;
      expect(m, id).not.toBeNull();
      expect(m.user.length, id).toBe(Object.keys(files).length - 1);
    }
  });
});
