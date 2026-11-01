import { defineConfig } from "vite";

// COOP/COEP habilitan SharedArrayBuffer para el ring buffer de audio (M2).
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  root: "web",
  // GitHub Pages sirve el proyecto en /<repo>/; el workflow fija VITE_BASE.
  base: process.env.VITE_BASE ?? "/",
  publicDir: "public",
  assetsInclude: ["**/*.rom"],
  server: { headers: isolation, fs: { allow: [".."] } },
  preview: { headers: isolation },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
});
