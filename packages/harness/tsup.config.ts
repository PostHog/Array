import { cp } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/cli.ts",
    "src/session.ts",
    "src/spawn.ts",
    "src/extensions/registry.ts",
    "src/extensions/hog-branding/extension.ts",
    "src/extensions/hog-branding/index.ts",
    "src/extensions/posthog-provider/extension.ts",
    "src/extensions/posthog-provider/index.ts",
    "src/extensions/posthog-provider/provider.ts",
    "src/extensions/posthog-provider/models.ts",
    "src/extensions/posthog-provider/oauth.ts",
    "src/extensions/posthog-provider/gateway.ts",
    "src/extensions/posthog-provider/gateway-auth.ts",
    "src/extensions/web-access/extension.ts",
    "src/extensions/web-access/index.ts",
    "src/extensions/web-access/web-search.ts",
    "src/extensions/web-access/web-fetch.ts",
    "src/extensions/subagent/extension.ts",
    "src/extensions/subagent/index.ts",
    "src/extensions/subagent/agents.ts",
    "src/extensions/subagent/discovery.ts",
    "src/extensions/subagent/settings.ts",
    "src/extensions/subagent/policy.ts",
    "src/extensions/subagent/auth.ts",
    "src/extensions/subagent/context.ts",
    "src/extensions/subagent/process/child-process.ts",
    "src/extensions/subagent/run-agent.ts",
    "src/extensions/subagent/process/pool.ts",
    "src/extensions/subagent/chain.ts",
    "src/extensions/subagent/lifecycle.ts",
    "src/extensions/subagent/render.ts",
    "src/extensions/subagent/text-truncate.ts",
    "src/extensions/subagent/format.ts",
    "src/pi-cli.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  outDir: "dist",
  target: "node20",
  async onSuccess() {
    // Prompt templates and the bundled skill are static data (no compilation
    // needed), but they must land next to the compiled subagent extension so
    // `resources_discover`'s `import.meta.url`-relative paths find them at
    // runtime.
    await cp(
      "src/extensions/subagent/prompts",
      "dist/extensions/subagent/prompts",
      {
        recursive: true,
      },
    );
    await cp(
      "src/extensions/subagent/skills",
      "dist/extensions/subagent/skills",
      {
        recursive: true,
      },
    );
  },
});
