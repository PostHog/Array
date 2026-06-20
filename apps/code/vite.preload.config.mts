import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { autoServicesPlugin } from "./vite-plugin-auto-services";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    tsconfigPaths({ ignoreConfigErrors: true }),
    autoServicesPlugin(path.join(__dirname, "src/main/services")),
  ],
  resolve: {
    conditions: ["node"],
    mainFields: ["module", "jsnext:main", "jsnext"],
  },
  build: {
    outDir: path.join(__dirname, ".vite/build"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "src/main/preload.ts"),
      external: [
        "electron",
        "electron/renderer",
        "electron/common",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
      output: {
        format: "cjs",
        inlineDynamicImports: true,
        entryFileNames: "preload.js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
});
