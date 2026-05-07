import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

function copyAssets() {
  const distDir = resolve(import.meta.dirname, "dist");
  const templatesDir = resolve(distDir, "templates");
  const claudeCliDir = resolve(distDir, "claude-cli");

  mkdirSync(templatesDir, { recursive: true });
  mkdirSync(claudeCliDir, { recursive: true });

  const srcTemplatesDir = resolve(import.meta.dirname, "src/templates");
  if (existsSync(srcTemplatesDir)) {
    cpSync(srcTemplatesDir, templatesDir, { recursive: true });
  }

  const claudeSdkPath = resolve(
    import.meta.dirname,
    "../../node_modules/@anthropic-ai/claude-agent-sdk",
  );
  const cliJsPath = resolve(claudeSdkPath, "cli.js");
  if (existsSync(cliJsPath)) {
    copyFileSync(cliJsPath, resolve(claudeCliDir, "cli.js"));
  }

  writeFileSync(
    resolve(claudeCliDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2),
  );

  const yogaWasmPath = resolve(
    import.meta.dirname,
    "../../node_modules/yoga-wasm-web/dist/yoga.wasm",
  );
  if (existsSync(yogaWasmPath)) {
    copyFileSync(yogaWasmPath, resolve(claudeCliDir, "yoga.wasm"));
  }

  const vendorDir = resolve(claudeSdkPath, "vendor");
  if (existsSync(vendorDir)) {
    cpSync(vendorDir, resolve(claudeCliDir, "vendor"), { recursive: true });
  }
}

const sharedOptions = {
  sourcemap: true,
  splitting: false,
  outDir: "dist",
  target: "node20",
  noExternal: ["@posthog/shared", "@posthog/git", "@posthog/enricher"],
  external: [
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
    "@agentclientprotocol/sdk",
    "@anthropic-ai/claude-agent-sdk",
    "dotenv",
    "openai",
    "tar",
    "zod",
  ],
};

export default defineConfig([
  {
    entry: [
      "src/index.ts",
      "src/agent.ts",
      "src/gateway-models.ts",
      "src/handoff-checkpoint.ts",
      "src/posthog-api.ts",
      "src/pr-url-detector.ts",
      "src/resume.ts",
      "src/types.ts",
      "src/adapters/claude/questions/utils.ts",
      "src/adapters/claude/permissions/permission-options.ts",
      "src/adapters/claude/tools.ts",
      "src/adapters/claude/conversion/tool-use-to-acp.ts",
      "src/adapters/claude/session/jsonl-hydration.ts",
      "src/adapters/claude/session/models.ts",
      "src/adapters/codex/models.ts",
      "src/adapters/claude/mcp/tool-metadata.ts",
      "src/adapters/codex/structured-output-mcp-server.ts",
      "src/adapters/reasoning-effort.ts",
      "src/execution-mode.ts",
      "src/server/schemas.ts",
      "src/server/agent-server.ts",
    ],
    format: ["esm"],
    dts: true,
    clean: false,
    ...sharedOptions,
    onSuccess: async () => {
      copyAssets();
      console.log("Assets copied successfully");

      // Touch a trigger file to signal electron-forge to restart
      // This file is watched by Vite, triggering main process rebuild
      // Skip in Docker/CI environments where the code app doesn't exist
      const triggerFile = resolve(
        import.meta.dirname,
        "../../apps/code/src/main/.agent-trigger",
      );
      const triggerDir = resolve(
        import.meta.dirname,
        "../../apps/code/src/main",
      );
      if (existsSync(triggerDir)) {
        writeFileSync(triggerFile, `${Date.now()}`);
      }
    },
  },
  {
    entry: { "server/bin": "src/server/bin.ts" },
    format: ["cjs"],
    dts: false,
    clean: false,
    ...sharedOptions,
  },
]);
