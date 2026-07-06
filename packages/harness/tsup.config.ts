import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/cli.ts",
    "src/session.ts",
    "src/spawn.ts",
    "src/extensions/registry.ts",
    "src/extensions/posthog-provider/extension.ts",
    "src/extensions/posthog-provider/provider.ts",
    "src/extensions/posthog-provider/models.ts",
    "src/extensions/posthog-provider/oauth.ts",
    "src/extensions/posthog-provider/gateway.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  outDir: "dist",
  target: "node20",
});
