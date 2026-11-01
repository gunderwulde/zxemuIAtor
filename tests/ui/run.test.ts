// I1: "Ensamblar y ejecutar" contra el núcleo real (core.wasm + ROM 48K).
// Oráculos:
//  - ROM: punto seguro y retorno (The Complete Spectrum ROM Disassembly; ver run.ts), texto
//    de los informes ("0 OK", "J Invalid I/O device") y la fuente de 0x3D00 (OCR).
//  - DOC docs/zx48-hardware.md §3: paleta (normal = 0xD7, índice GRB).
//  - Valores escritos a mano a partir de la fuente de cada ejemplo (no del ensamblador).
import { beforeEach, describe, expect, it } from "vitest";
import { Core } from "../../web/src/emu/core";
import { EXAMPLES } from "../../web/src/ui/editor/examples";
import { assembleAndRun, atSafePoint, seekSafePoint, SAFE_PC } from "../../web/src/ui/run";
import { assemble } from "../../web/src/asm";
import { KEY, typeKeys } from "../util/keys";
import { screenLines } from "../util/screen";
import { instantiate, rom48 } from "../util/wasm";

const src = (id: string) => EXAMPLES.find((e) => e.id === id)!.source;

let core: Core;
async function booted(): Promise<Core> {
  const c = new Core(await instantiate("core"));
  c.loadRom(rom48());
  for (let i = 0; i < 150; i++) c.runFrame();
  return c;
}
beforeEach(async () => { core = await booted(); });

const frames = (n: number) => { for (let i = 0; i < n; i++) core.runFrame(); };
const peek16 = (a: number) => core.ram()[a]! | (core.ram()[a + 1]! << 8);
const text = () => screenLines(core.ram());

// DOC §3: componente normal 0xD7; índice GRB (bit 2 verde, bit 1 rojo, bit 0 azul).
function colourAt(x: number, y: number): number {
  const fb = core.framebuffer();
  const i = (y * 352 + x) * 4;
  const on = (v: number) => (v === 0xd7 ? 1 : v === 0 ? 0 : NaN);
  return on(fb[i + 1]!) * 4 + on(fb[i]!) * 2 + on(fb[i + 2]!);
}
/** Columna 4 del borde izquierdo, las 296 líneas. */
const borderColumn = () => Array.from({ length: 296 }, (_, y) => colourAt(4, y));

function press(k: string, n: number) {
  core.x.zx_key(KEY[k]![0], KEY[k]![1], 1);
  frames(n);
  core.x.zx_key(KEY[k]![0], KEY[k]![1], 0);
}

/** Tras volver, BASIC responde: se teclea un PRINT y se ve el resultado y el informe. */
function basicResponds() {
  typeKeys(core, "PRINT 7*6\n");
  frames(10);
  const t = text();
  expect(t.some((l) => /\b42\b/.test(l)), t.join("\n")).toBe(true);
  expect(t[22]! + t[23]!).toContain("0 OK, 0:1");
}

describe("punto seguro", () => {
  it("tras el arranque la ROM está en WAIT-KEY1 (15DEh) con la vuelta a ED-LOOP (0F3Bh) en la pila", () => {
    expect(seekSafePoint(core)).toBe(true);
    expect(core.regs.get16("pc")).toBe(0x15de);
    expect(peek16(core.regs.get16("sp"))).toBe(0x0f3b);
  });

  it("un PUSH PC desnudo no basta: con el canal S abierto la ROM salta a REPORT-J (15C4h) y borra la pantalla", () => {
    // Es el diseño ingenuo que el trampolín de run.ts evita (test que fallaría sin él).
    seekSafePoint(core);
    const r = assemble(src("hello"));
    for (const s of r.segments) s.bytes.forEach((b, i) => core.x.zx_poke(s.addr + i, b));
    const sp = core.regs.get16("sp") - 2;
    core.x.zx_poke(sp, SAFE_PC & 0xff);
    core.x.zx_poke(sp + 1, SAFE_PC >> 8);
    core.regs.set16("sp", sp);
    core.x.zx_set_pc(r.entry);
    let hitJ = false;
    for (let k = 0; k < 100000 && !hitJ; k++) {
      core.x.zx_step();
      hitJ = core.regs.get16("pc") === 0x15c4;
    }
    expect(hitJ).toBe(true);
    frames(20);
    expect(text()[10]).not.toContain("Hola, mundo!"); // ED-ERROR → MAIN-EXEC: AUTO-LIST limpia
  });
});

describe("ensamblar y ejecutar", () => {
  it("hola mundo: el texto aparece en AT 10,9, RET vuelve al editor con la pila intacta y BASIC responde", () => {
    seekSafePoint(core);
    const sp0 = core.regs.get16("sp");
    const r = assembleAndRun(core, src("hello"));
    expect(r.ok, JSON.stringify(r.messages)).toBe(true);
    expect(r.reset).toBe(false);
    expect(r.messages.filter((m) => m.severity !== "info")).toEqual([]);
    expect(core.regs.get16("pc")).toBe(0x8000); // "org 8000h" + "end start"
    frames(5);
    expect(text()[10]!.slice(9, 21)).toBe("Hola, mundo!");
    expect(colourAt(4, 4)).toBe(1); // borde azul (BORDER_COL equ 1)
    expect(core.regs.get16("pc")).toBeLessThan(0x4000);
    expect(seekSafePoint(core)).toBe(true);
    expect(core.regs.get16("sp")).toBe(sp0);
    frames(20);
    expect(text()[10]!.slice(9, 21)).toBe("Hola, mundo!"); // sigue ahí: no hubo error
    expect(text().join("\n")).not.toMatch(/Invalid I\/O|Nonsense/);
    basicResponds();
  });

  it("se puede ejecutar dos veces seguidas", () => {
    expect(assembleAndRun(core, src("hello")).ok).toBe(true);
    frames(5);
    const again = assembleAndRun(core, src("hello"));
    expect(again.ok).toBe(true);
    expect(again.reset).toBe(false);
    frames(5);
    basicResponds();
  });

  it("si la máquina no está en el editor (programa colgado) se reinicia y se ejecuta igual", () => {
    expect(assembleAndRun(core, "org 8000h\nhang: jr hang\n").ok).toBe(true);
    frames(3);
    expect(atSafePoint(core)).toBe(false);
    const r = assembleAndRun(core, src("hello"));
    expect(r.ok).toBe(true);
    expect(r.reset).toBe(true);
    frames(5);
    expect(text()[10]!.slice(9, 21)).toBe("Hola, mundo!");
    basicResponds();
  });

  it("errores: no toca la máquina y da línea y columna", () => {
    const pc = core.regs.get16("pc");
    const r = assembleAndRun(core, "        org 8000h\n        ld a,1\n        ld q,2\n        ret\n");
    expect(r.ok).toBe(false);
    expect(r.asm.errors.some((e) => e.severity === "error" && e.line === 3)).toBe(true);
    expect(r.messages.some((m) => m.severity === "error" && m.text.startsWith("3:"))).toBe(true);
    expect(core.regs.get16("pc")).toBe(pc);
  });

  it("rechaza escribir en ROM con un error claro", () => {
    const r = assembleAndRun(core, "org 3FFEh\ndb 1,2,3,4\n");
    expect(r.ok).toBe(false);
    expect(r.messages.find((m) => m.severity === "error")!.text).toContain("3FFEh–4001h cae en la ROM");
  });

  it("avisa si pisa las variables del sistema o la pila; la pantalla no avisa", () => {
    const screen = assembleAndRun(core, "org 4000h\ndb 255\nret\n");
    expect(screen.ok).toBe(true);
    expect(screen.messages.filter((m) => m.severity === "warning")).toEqual([]);
    frames(3);
    const sys = assembleAndRun(core, "org 5C3Ah\ndb 0\n");
    expect(sys.messages.some((m) => m.severity === "warning" && m.text.includes("variables del sistema"))).toBe(true);
    core.x.zx_reset();
    frames(150);
    seekSafePoint(core);
    const sp = core.regs.get16("sp");
    const st = assembleAndRun(core, `org ${sp - 4}\ndb 0,0,0,0,0,0,0,0\n`);
    expect(st.messages.some((m) => m.severity === "warning" && m.text.includes("pila"))).toBe(true);
  });
});

describe("ejemplos", () => {
  it("todos ensamblan sin errores ni avisos", () => {
    for (const ex of EXAMPLES) expect(assemble(ex.source).errors, ex.id).toEqual([]);
  });

  it("el ejemplo por defecto (arco iris) anima pantalla y borde y ESPACIO vuelve a BASIC", () => {
    expect(EXAMPLES[0]!.id).toBe("demo");
    expect(assembleAndRun(core, src("demo")).ok).toBe(true);
    frames(3);
    const ram = core.ram();
    const a0 = ram.slice(0x5800, 0x5800 + 22 * 32);
    // A mano desde la fuente: bandas de 4 celdas con PAPER = color, BRIGHT, tinta 0; la
    // fila siguiente empieza un color después (diagonal): attr(1,0) = attr(0,4).
    for (const v of a0) expect(v & 0xc7).toBe(0x40);
    expect(a0[0]).toBe(a0[1]);
    expect(a0[4]).toBe(a0[32]);
    expect(((a0[4]! >> 3) - (a0[0]! >> 3)) & 7).toBe(1);
    const b0 = borderColumn();
    expect(new Set(b0).size).toBeGreaterThanOrEqual(6); // rayas en el borde
    frames(1);
    const a1 = core.ram().slice(0x5800, 0x5800 + 22 * 32);
    // "dec e": cada frame empieza un color antes → las bandas se desplazan.
    expect(((a0[0]! >> 3) - (a1[0]! >> 3)) & 7).toBe(1);
    expect(borderColumn()).not.toEqual(b0);
    // Las dos filas del editor (22-23) no se tocan.
    expect(core.ram()[0x5800 + 22 * 32]).toBe(0x38);

    press("SPACE", 4);
    frames(10);
    expect(core.regs.get16("pc")).toBeLessThan(0x4000);
    // Atributos y borde restaurados: ATTR_P y BORDCR tras el arranque = 38h (papel blanco).
    expect([...core.ram().slice(0x5800, 0x5800 + 22 * 32)].every((v) => v === 0x38)).toBe(true);
    expect(colourAt(4, 4)).toBe(7);
    expect(seekSafePoint(core)).toBe(true);
    basicResponds();
  });

  it("borde: recorre los 8 colores en orden y lo deja verde (BORDCR = 20h)", () => {
    expect(assembleAndRun(core, src("border")).ok).toBe(true);
    const seen: number[] = [];
    for (let f = 0; f < 8 * 25 + 10; f++) {
      core.runFrame();
      const c = colourAt(4, 150);
      if (seen[seen.length - 1] !== c) seen.push(c);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 4]);
    expect(core.ram()[23624]).toBe(0x20); // papel verde (4·8), tinta negra
    expect(core.regs.get16("pc")).toBeLessThan(0x4000);
    basicResponds();
    expect(colourAt(4, 150)).toBe(4); // la ROM repone el borde desde BORDCR
  });

  it("rayas multicolor: 8 líneas por raya en el borde superior, color +1 por frame, ESPACIO sale", () => {
    expect(assembleAndRun(core, src("stripes")).ok).toBe(true);
    frames(3);
    const f0 = borderColumn();
    frames(1);
    const f1 = borderColumn();
    // Cada línea: el color del frame siguiente es el de éste + 1 (mod 8).
    const ok = f0.filter((c, y) => f1[y] === ((c + 1) & 7)).length;
    expect(ok / f0.length).toBeGreaterThan(0.95);
    // Cambios de color en el borde superior (líneas 0-47 del framebuffer, sin contención):
    // separados exactamente 8 líneas (1792 T / 224 T por línea).
    const edges = [];
    for (let y = 1; y < 48; y++) if (f0[y] !== f0[y - 1]) edges.push(y);
    expect(edges.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < edges.length; i++) expect(edges[i]! - edges[i - 1]!).toBe(8);

    press("SPACE", 4);
    frames(10);
    expect(core.regs.get16("pc")).toBeLessThan(0x4000);
    expect(colourAt(4, 150)).toBe(7);
    basicResponds();
  });
});
