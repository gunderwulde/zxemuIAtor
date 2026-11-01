// Descarga las suites externas de tests a tests/fixtures/ (no versionado) y verifica
// sus SHA-256. Ver docs/TEST-PLAN.md.
//
// Uso: node tools/fetch-tests.mjs [--singlestep]
//   --singlestep  además clona SingleStepTests/z80 (≈1 GB descomprimido, opcional).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = join(root, "tests", "fixtures");

const FUSE = "https://sourceforge.net/p/fuse-emulator/fuse/ci/master/tree/z80/tests";
const ZEX = "https://raw.githubusercontent.com/agn453/ZEXALL/main";
const FILES = [
  { path: "fuse/tests.in", url: `${FUSE}/tests.in?format=raw`,
    sha: "9f36e866f22e72ff1f8bf2100bf70ffbf58edd97b453500aab60acf1f403ebbb" },
  { path: "fuse/tests.expected", url: `${FUSE}/tests.expected?format=raw`,
    sha: "15a6946f4addcf97e137b5bdd1d5fdb08124ff91f1b169f36a8bf4afe4bab6e4" },
  { path: "zex/zexdoc.com", url: `${ZEX}/zexdoc.com`,
    sha: "34923a7ed82285d3038b2d54bd64899e12173eebb61f9d07b4fc72e78af2ae8f" },
  { path: "zex/zexall.com", url: `${ZEX}/zexall.com`,
    sha: "6e2da55147a04f28d303d5da6a1e6b771557ac244653590a0f24a2d39c8537e8" },
  { path: "z80test/z80test-1.2a.zip",
    url: "https://github.com/raxoft/z80test/releases/download/v1.2a/z80test-1.2a.zip",
    sha: "7df0443d703e6b3114ea04b4cdef3e13b91421c62e37185c1036d06864cacbaf", unzip: true },
];

const sha = (b) => createHash("sha256").update(b).digest("hex");

function unzip(zip, dir) {
  // Windows 10+ trae bsdtar (sabe leer zip); en el resto se usa unzip.
  if (process.platform === "win32") {
    execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", dir]);
  } else {
    execFileSync("unzip", ["-o", "-q", zip, "-d", dir]);
  }
}

let failed = false;
for (const f of FILES) {
  const dst = join(fx, f.path);
  if (existsSync(dst) && sha(readFileSync(dst)) === f.sha) {
    console.log(`${f.path} OK`);
    continue;
  }
  try {
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) !== f.sha) throw new Error(`SHA-256 incorrecto (${buf.length} bytes)`);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, buf);
    if (f.unzip) unzip(dst, dirname(dst));
    console.log(`${f.path} descargado`);
  } catch (e) {
    console.error(`${f.path}: ${e.message}`);
    failed = true;
  }
}

if (process.argv.includes("--singlestep")) {
  const dir = join(fx, "singlestep");
  if (existsSync(join(dir, "v1"))) {
    console.log("singlestep OK (ya clonado)");
  } else {
    // Clon superficial y disperso: sólo v1/ (los JSON por opcode).
    const git = (...a) => execFileSync("git", a, { stdio: "inherit" });
    git("clone", "--depth", "1", "--filter=blob:none", "--sparse", "https://github.com/SingleStepTests/z80", dir);
    git("-C", dir, "sparse-checkout", "set", "v1");
  }
}

process.exit(failed ? 1 : 0);
