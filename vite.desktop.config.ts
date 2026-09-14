import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "desktop/renderer",
  base: "/",
  publicDir: resolve("public"),
  plugins: [react()],
  build: {
    outDir: resolve("dist-desktop/renderer"),
    emptyOutDir: true,
    sourcemap: false,
    target: "chrome142",
  },
});
