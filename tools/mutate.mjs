// Mutaciones obligatorias de docs/TEST-PLAN.md §7: prueba que los tests detectan fallos.
//
// Para cada mutación: copia core/ y tools/build-core.mjs a build/t1-mutate/, aplica la
// mutación SÓLO a la copia, compila core-test y core-probe allí y ejecuta la suite fast.
// Una mutación está "detectada" si falla algún test que no fallaba sin mutar (línea
// base, ejecutada primero con la misma copia). Nunca toca core/src real.
//
// Uso: node tools/mutate.mjs [nombre…]       (sin nombres, todas)
//   ZX_MUTATE_TESTS="…"   rutas de vitest (por defecto FUSE, SST, tests/core/ula y
//                         tests/core/machine; con tests/core entero tarda ~24 min)
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(root, "build", "t1-mutate");
const wasmRel = "build/t1-mutate/wasm"; // relativo a la raíz real (tests/util/wasm.ts)
const testPaths = (process.env.ZX_MUTATE_TESTS ?? "tests/core/cpu/fuse.test.ts tests/core/cpu/singlestep.test.ts tests/core/ula tests/core/machine").split(/\s+/).filter(Boolean);

// { name, file, find, replace, detect } — `find` debe aparecer exactamente una vez.
const MUTATIONS = [
  {
    name: "inc-hl-sin-contend",
    file: "z80.c",
    find: "        uint8_t v = bus_read(HL, 3);\n        bus_contend(HL, 1);\n        bus_write(HL, z80_inc8(r, v), 3);",
    replace: "        uint8_t v = bus_read(HL, 3);\n        bus_tick(1);\n        bus_write(HL, z80_inc8(r, v), 3);",
    detect: "CPU-01, ULA-02",
  },
  { name: "contencion-14336", file: "zx48.c", find: "uint32_t start = 14335 +", replace: "uint32_t start = 14336 +", detect: "ULA-01, 02" },
  { name: "patron-rotado", file: "zx48.c", find: "{ 6, 5, 4, 3, 2, 1, 0, 0 }", replace: "{ 5, 4, 3, 2, 1, 0, 0, 6 }", detect: "ULA-01" },
  {
    name: "ccf-sin-q",
    file: "z80.c",
    find: "(((qprev ^ F) | A) & (F3 | F5)) | ((F & FC) ? FH : FC)",
    replace: "((F | A) & (F3 | F5)) | ((F & FC) ? FH : FC)",
    detect: "CPU-03, 21",
  },
  { name: "jp-sin-memptr", file: "z80.c", find: "case 0xC3: WZ = z80_imm16(r); PC = WZ; break;", replace: "case 0xC3: PC = z80_imm16(r); break;", detect: "CPU-04" },
  {
    name: "r-sin-inc-tras-dd",
    file: "z80.c",
    find: "#define XYL xy->b.l\n    op = z80_fetch(r);",
    replace: "#define XYL xy->b.l\n    op = bus_read(PC, 4); PC++;",
    detect: "CPU-05",
  },
  { name: "ei-inmediato", file: "z80.c", find: "case 0xFB: r->iff1 = r->iff2 = 1; r->ei_delay = 1; break;", replace: "case 0xFB: r->iff1 = r->iff2 = 1; r->ei_delay = 0; break;", detect: "CPU-07" },
  { name: "int-31", file: "zx48.c", find: "return zx.int_enabled && zx.t < 32;", replace: "return zx.int_enabled && zx.t < 31;", detect: "ULA-10" },
  {
    // El borde se aplica 2 T más tarde: deja de estar alineado a los grupos de 4 T.
    name: "borde-desplazado-2t",
    file: "zx48.c",
    find: "        video_catch_up(zx.t);\n        audio_out(zx.t, v);",
    replace: "        video_catch_up(zx.t + 2);\n        audio_out(zx.t, v);",
    detect: "ULA-32",
  },
  {
    // Al entrar en una línea se dibuja entera: atributos leídos al principio de la línea.
    name: "render-linea-entera",
    file: "video.c",
    find: "uint32_t col = (d % ZX_TSTATES_PER_LINE) / 4 + 1;",
    replace: "uint32_t col = COLS;",
    detect: "ULA-33, 34",
  },
  {
    name: "bus-flotante-1t",
    file: "zx48.c",
    find: "static uint8_t floating_bus(void)\n{\n    uint32_t t = zx.t;",
    replace: "static uint8_t floating_bus(void)\n{\n    uint32_t t = zx.t + 1;",
    detect: "ULA-23",
  },
  { name: "issue-invertido", file: "zx48.c", find: ": zx.issue == 2 ? (zx.last_fe & 0x18)", replace: ": zx.issue == 3 ? (zx.last_fe & 0x18)", detect: "ULA-21" },
];

function prepare() {
  rmSync(join(work, "core"), { recursive: true, force: true });
  mkdirSync(join(work, "tools"), { recursive: true });
  cpSync(join(root, "core"), join(work, "core"), { recursive: true });
  cpSync(join(root, "tools", "build-core.mjs"), join(work, "tools", "build-core.mjs"));
}

function build() {
  // build-core.mjs resuelve core/src relativo a sí mismo → compila la copia.
  const r = spawnSync(process.execPath, [join(work, "tools", "build-core.mjs"), "core-test", "core-probe"], {
    env: { ...process.env, ZX_BUILD_DIR: "wasm" },
    encoding: "utf8",
  });
  return r.status === 0 ? null : (r.stdout + r.stderr).slice(-2000);
}

/** Ejecuta vitest y devuelve el conjunto de tests fallidos ("fichero > nombre completo"). */
function runTests() {
  const out = join(work, "result.json");
  rmSync(out, { force: true });
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  spawnSync(npx, ["vitest", "run", ...testPaths, "--reporter=json", `--outputFile=${out}`], {
    cwd: root,
    env: { ...process.env, ZX_BUILD_DIR: wasmRel, ZX_FULL: "", ZX_SOAK: "" },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (!existsSync(out)) throw new Error("vitest no produjo resultados");
  const json = JSON.parse(readFileSync(out, "utf8"));
  const failed = new Set();
  for (const f of json.testResults) {
    const rel = f.name.replace(/\\/g, "/").replace(root.replace(/\\/g, "/") + "/", "");
    if (f.status === "failed" && f.assertionResults.length === 0) failed.add(`${rel} > (carga del fichero)`);
    for (const a of f.assertionResults) if (a.status === "failed") failed.add(`${rel} > ${a.fullName}`);
  }
  return failed;
}

const only = process.argv.slice(2);
const list = only.length ? MUTATIONS.filter((m) => only.includes(m.name)) : MUTATIONS;

prepare();
let err = build();
if (err) { console.error("La línea base no compila:\n" + err); process.exit(1); }
const base = runTests();
console.log(`línea base: ${base.size} tests fallan sin mutar`);

let undetected = 0;
for (const m of list) {
  prepare();
  const path = join(work, "core", "src", m.file);
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const n = text.split(m.find).length - 1;
  if (n !== 1) {
    console.log(`?? ${m.name}: el patrón aparece ${n} veces en ${m.file} (¿ha cambiado el código?)`);
    undetected++;
    continue;
  }
  writeFileSync(path, text.replace(m.find, m.replace));
  err = build();
  if (err) {
    console.log(`?? ${m.name}: no compila\n${err}`);
    undetected++;
    continue;
  }
  const failed = [...runTests()].filter((t) => !base.has(t));
  if (failed.length) {
    console.log(`OK ${m.name} (debe detectarla ${m.detect}): ${failed.length} tests nuevos fallan, p. ej.`);
    for (const t of failed.slice(0, 3)) console.log(`     ${t}`);
  } else {
    console.log(`XX ${m.name} (debe detectarla ${m.detect}): NO DETECTADA`);
    undetected++;
  }
}
prepare(); // deja la copia sin mutar
console.log(undetected ? `${undetected} mutaciones sin detectar` : "todas las mutaciones detectadas");
process.exit(undetected ? 1 : 0);
