import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    // Los *.bench-test.ts miden tiempos: van en npm run test:perf (vitest.perf.config.ts), nunca con la suite en paralelo.
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    // Varios beforeAll compilan su wasm con clang; con la suite en paralelo superan los 10 s.
    hookTimeout: 60_000,
  },
});
