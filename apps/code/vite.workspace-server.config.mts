import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { mainAliases } from "./vite.shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

// Native modules (.node binaries) can't be bundled — they stay external and are
// resolved from the packaged node_modules at runtime, exactly as the main bundle
// treats them (see vite.main.config.mts). Everything else (pure JS) is bundled
// into workspace-server.js so the spawned child is self-contained and does not
// depend on node_modules being present next to the bundle in the packaged app.
const nativeModules = new Set([
  "@parcel/watcher",
  "node-pty",
  "better-sqlite3",
  "file-icon",
]);

const isExternal = (id: string): boolean =>
  nodeBuiltins.has(id) || nativeModules.has(id);

export default defineConfig({
  resolve: {
    alias: mainAliases,
    conditions: ["node"],
  },
  cacheDir: ".vite/cache-workspace-server",
  // ssr.noExternal forces deps to be bundled; without it an SSR build leaves all
  // node_modules imports external, which is what broke the packaged child.
  ssr: {
    noExternal: true,
    external: [...nativeModules],
  },
  build: {
    target: "node18",
    sourcemap: true,
    minify: false,
    reportCompressedSize: false,
    outDir: path.join(__dirname, ".vite/build"),
    emptyOutDir: false,
    ssr: true,
    lib: {
      entry: require.resolve("@posthog/workspace-server/serve"),
      formats: ["cjs"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "workspace-server.js",
      },
      external: isExternal,
    },
  },
});
