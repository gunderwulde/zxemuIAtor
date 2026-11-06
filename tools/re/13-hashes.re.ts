// Imprime los SHA-256 de los bloques de la cinta original (para fijarlos en tests/examples/sootland.test.ts).
import { it } from "vitest";
import { createHash } from "node:crypto";
import { WORK, readTzx, tapBlocks, tzxToTap } from "./common";

it("hashes", () => {
  const orig = [...tapBlocks(tzxToTap(readTzx("Sootland - Side 1.tzx"))), ...tapBlocks(tzxToTap(readTzx("Sootland - Side 2.tzx")))];
  require("node:fs").writeFileSync(require("node:path").join(WORK, "hashes.txt"), orig.map((b) => `  "${createHash("sha256").update(b).digest("hex").slice(0, 16)}", // ${b.length}`).join("\n"));
});
