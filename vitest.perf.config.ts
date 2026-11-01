import { defineConfig } from "vitest/config";

// Tests de tiempo: un solo fichero a la vez para que la carga de otros tests no los falsee.
export default defineConfig({
  test: {
    root: ".",
    include: ["tests/**/*.bench-test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
