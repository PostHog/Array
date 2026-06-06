import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import {
  createForceDevModeDefine,
  createPosthogPlugin,
  rendererAliases,
} from "./vite.shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, "../.."), "");

  return {
    plugins: [
      // Source Inspector: hold Shift+Alt+Ctrl (⌘ on Mac) and click any element
      // in dev to jump to its source. Dev-only so the data-tsd-source attrs it
      // injects never ship in a packaged build.
      mode === "development" && devtools(),
      TanStackRouterVite({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: path.resolve(__dirname, "src/renderer/routes"),
        generatedRouteTree: path.resolve(
          __dirname,
          "src/renderer/routeTree.gen.ts",
        ),
      }),
      tailwindcss(),
      react(),
      tsconfigPaths(),
      createPosthogPlugin(env, "posthog-code-renderer"),
    ].filter(Boolean),
    worker: {
      format: "es",
    },
    build: {
      sourcemap: true,
    },
    envDir: path.resolve(__dirname, "../.."),
    define: {
      ...createForceDevModeDefine(),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: rendererAliases,
      dedupe: ["react", "react-dom"],
    },
  };
});
