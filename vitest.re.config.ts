import { defineConfig } from "vitest/config";

// Ingeniería inversa (tools/re): scripts que se ejecutan como "tests" para reutilizar el
// núcleo y el desensamblador TS sin empaquetar. No forman parte de npm test.
export default defineConfig({
  test: { root: ".", include: ["tools/re/**/*.re.ts"], testTimeout: 1_800_000, hookTimeout: 120_000, fileParallelism: false },
});
