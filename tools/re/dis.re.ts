import { it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { disassembleRange } from "../../web/src/disasm";
import { WORK } from "./common";
it("dis", () => {
  const [file, addr, count] = (process.env.DIS ?? "").split(",");
  const m = readFileSync(join(WORK, file!));
  console.log(disassembleRange(m, parseInt(addr!, 16), +count!).map((l) => `${l.addr.toString(16)}: ${l.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(12)} ${l.text}`).join("\n"));
});
