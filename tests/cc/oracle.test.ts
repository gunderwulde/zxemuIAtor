// K1: oráculo independiente. tests/cc/oracle.c compilado con clang (wasm32, tipos de 16
// bits) y con K1 (Z80, en el núcleo real) debe dejar los mismos 288 valores. Si clang no
// está instalado el test se salta con aviso (AGENTS.md: LLVM en C:\Program Files\LLVM\bin).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../util/wasm";
import { runC } from "./harness";

const LLVM = process.env.LLVM_BIN ?? "C:\\Program Files\\LLVM\\bin";
const CLANG = join(LLVM, process.platform === "win32" ? "clang.exe" : "clang");
const SRC = join(ROOT, "tests", "cc", "oracle.c");
const N = 48 * 6;

describe.skipIf(!existsSync(CLANG))("oráculo clang", () => {
  it("mismos resultados que clang con tipos de 16 bits", async () => {
    const outDir = join(ROOT, "build", "cc-oracle");
    mkdirSync(outDir, { recursive: true });
    const wasm = join(outDir, "oracle.wasm");
    execFileSync(CLANG, ["--target=wasm32", "-nostdlib", "-O1", "-std=c99", "-Wall", "-Wl,--no-entry", "-o", wasm, SRC]);
    const { instance } = await WebAssembly.instantiate(readFileSync(wasm), {});
    const ex = instance.exports as { run(): number; memory: WebAssembly.Memory };
    const p = ex.run();
    const ref = Array.from(new Uint16Array(ex.memory.buffer, p, N));

    const r = await runC(readFileSync(SRC, "utf8"));
    const got = Array.from({ length: N }, (_, i) => r.u16("out", i));
    expect(got).toEqual(ref);
    expect(ref[N - 1]).toBe(2584); // fib(18), a mano
  });
});
