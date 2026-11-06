// Ejemplo Sootland: el proyecto de web/src/examples/sootland/ debe reconstruir la cinta original
// bloque a bloque (se comparan SHA-256 de la cinta de Zafiro, que no está en el repo) y el juego
// reconstruido tiene que arrancar y cargar el nivel 1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Core } from "../../web/src/emu/core";
import { registerResource, unregisterResource } from "../../web/src/res/registry";
import { scrResource } from "../../web/src/res/scr";
import { tilesResource } from "../../web/src/res/tiles";
import { tapeResource } from "../../web/src/res/tape";
import { TabsModel } from "../../web/src/ui/tabs/model";
import { buildProject } from "../../web/src/ui/tabs/project";
import { startTape } from "../../web/src/ui/tape-run";
import { KEY, press, runFrames } from "../core/tape/tap";
import { instantiate, ROOT, rom48 } from "../util/wasm";

const DIR = join(ROOT, "web", "src", "examples", "sootland");
// SHA-256 (16 primeros hex) de los 14 bloques de la cinta original, con flag y checksum: BASIC (cabecera
// y datos), loader.bin, motor, 4×(cabecera, cuerpo) de nivel y el bloque final.
const ORIGINAL = [
  "8d678dc0a5c38c67", "a70e5cc0fe126a9c", "bc282e60e704b12e", "23c6c94aca883463", "0963d634a8dececf",
  "30097969d16bbb24", "f14aca6762196eb7", "7a0c51375f170f41", "bdfea7793560ec33", "bc0bd0bd24aa0f39",
  "935cfcfbfd450f6e", "285da443ee3f2db2", "30d3d0ee6b03b609", "94192fe79f2bd6d2",
];
/** Bloques de un TAP (flag + datos + checksum, sin la longitud). */
function tapBlocks(t: number[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let p = 0; p < t.length;) {
    const n = t[p]! | (t[p + 1]! << 8);
    out.push(Uint8Array.from(t.slice(p + 2, p + 2 + n)));
    p += 2 + n;
  }
  return out;
}
const h = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);

beforeAll(() => { registerResource(scrResource); registerResource(tilesResource); registerResource(tapeResource); });
afterAll(() => { unregisterResource("scr"); unregisterResource("tiles"); unregisterResource("tape"); });

function load(): { m: TabsModel; tape: ReturnType<TabsModel["find"]> } {
  const proj = JSON.parse(readFileSync(join(DIR, "project.json"), "utf8")) as { files: string[]; main: string };
  const m = TabsModel.initial("", "");
  m.close(m.find("main.c")!.id);
  for (const n of proj.files) m.add(n, readFileSync(join(DIR, n), "utf8"));
  return { m, tape: m.find(proj.main) };
}

describe("ejemplo Sootland", () => {
  it("project.json lista todos los ficheros del directorio", () => {
    const proj = JSON.parse(readFileSync(join(DIR, "project.json"), "utf8")) as { files: string[] };
    expect([...proj.files].sort()).toEqual(readdirSync(DIR).filter((n) => n !== "project.json").sort());
  });

  it("reconstruye la cinta original byte a byte", () => {
    const { m, tape } = load();
    const r = buildProject(m, tape!);
    expect(r.messages.filter((x) => x.severity === "error")).toEqual([]);
    expect(tapBlocks([...r.tap!]).map(h)).toEqual(ORIGINAL);
  });

  it("el juego reconstruido arranca y carga el nivel 1", async () => {
    const { m, tape } = load();
    const r = buildProject(m, tape!);
    const core = new Core(await instantiate("core"));
    core.loadRom(rom48());
    expect(startTape(core, r.tap!)).toBeNull();
    runFrames(core, 300); press(core, [KEY.SPACE], 10); runFrames(core, 1000); press(core, [KEY.SPACE], 10); runFrames(core, 700);
    press(core, [[3, 1]], 10); runFrames(core, 80);
    core.x.zx_key(4, 0, 1); runFrames(core, 300); core.x.zx_key(4, 0, 0);
    runFrames(core, 200); press(core, [KEY.SPACE], 10); runFrames(core, 400);
    const ram = core.ram();
    expect(h(ram.subarray(0xca38, 0xca38 + 1222))).toBe(h(tapBlocks([...r.tap!])[5]!.subarray(1, -1)));   // cabecera del nivel 1
  });
});
