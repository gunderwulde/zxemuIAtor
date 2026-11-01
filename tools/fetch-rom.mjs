// Descarga la ROM original del Spectrum 48K desde la distribución de Fuse y verifica
// su SHA-256. La ROM se versiona en el repo (rom/48.rom); este script sirve para
// regenerarla o comprobarla.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dst = join(root, "rom", "48.rom");
const SHA256 = "d55daa439b673b0e3f5897f99ac37ecb45f974d1862b4dadb85dec34af99cb42";
const SOURCES = [
  "https://sourceforge.net/p/fuse-emulator/fuse/ci/master/tree/roms/48.rom?format=raw",
  "https://raw.githubusercontent.com/speccytools/fuse/master/roms/48.rom",
];

const sha = (b) => createHash("sha256").update(b).digest("hex");

if (existsSync(dst) && sha(readFileSync(dst)) === SHA256) {
  console.log("rom/48.rom OK");
  process.exit(0);
}

for (const url of SOURCES) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) !== SHA256) throw new Error(`SHA-256 incorrecto (${buf.length} bytes)`);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, buf);
    console.log(`rom/48.rom descargada de ${url}`);
    process.exit(0);
  } catch (e) {
    console.warn(`${url}: ${e.message}`);
  }
}
console.error("No se pudo obtener una ROM válida");
process.exit(1);
