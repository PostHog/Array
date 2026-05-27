import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

// SDK >=0.3.x ships the agent as a platform-specific native binary in
// `@anthropic-ai/claude-agent-sdk-${platform}-${arch}` instead of a JS cli.js.
// Resolve the matching package for the current build host and copy `claude`
// into dist/claude-cli/ so apps can point pathToClaudeCodeExecutable at it.
function nativeBinarySourcePath(): string | undefined {
  const { platform, arch } = process;
  const candidates =
    platform === "linux"
      ? [`${platform}-${arch}`, `${platform}-${arch}-musl`]
      : [`${platform}-${arch}`];
  const binName = platform === "win32" ? "claude.exe" : "claude";

  for (const slug of candidates) {
    const candidate = resolve(
      import.meta.dirname,
      `../../node_modules/@anthropic-ai/claude-agent-sdk-${slug}`,
      binName,
    );
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

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

  const binName = process.platform === "win32" ? "claude.exe" : "claude";
  const nativeBinary = nativeBinarySourcePath();
  if (nativeBinary) {
    const dest = resolve(claudeCliDir, binName);
    copyFileSync(nativeBinary, dest);
    if (process.platform !== "win32") {
      chmodSync(dest, 0o755);
    }
  } else {
    console.warn(
      `[agent/tsup] No native claude binary found for ${process.platform}-${process.arch}; install @anthropic-ai/claude-agent-sdk optional deps`,
    );
  }

  writeFileSync(
    resolve(claudeCliDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2),
  );
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
      "src/adapters/codex/local-tools-mcp-server.ts",
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
