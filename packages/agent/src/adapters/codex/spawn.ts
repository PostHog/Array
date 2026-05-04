import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { ProcessSpawnedCallback } from "../../types";
import { Logger } from "../../utils/logger";
import type { CodexSettings } from "./settings";

export interface CodexProcessOptions {
  cwd?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  reasoningEffort?: string;
  instructions?: string;
  binaryPath?: string;
  logger?: Logger;
  processCallbacks?: ProcessSpawnedCallback;
  settings?: CodexSettings;
  /** Additional writable roots passed to Codex's workspace-write sandbox. */
  additionalDirectories?: string[];
}

export interface CodexProcess {
  process: ChildProcess;
  stdin: Writable;
  stdout: Readable;
  kill: () => void;
}

function buildConfigArgs(options: CodexProcessOptions): string[] {
  const args: string[] = [];

  args.push("-c", `features.remote_models=false`);

  // Disable the user's local MCPs one-by-one so Codex only uses the MCPs we
  // provide via ACP. We can't use `-c mcp_servers={}` because that makes Codex
  // ignore MCPs entirely, including the ones we inject later.
  for (const name of options.settings?.mcpServerNames ?? []) {
    args.push("-c", `mcp_servers.${name}.enabled=false`);
  }

  if (options.apiBaseUrl) {
    args.push("-c", `model_provider="posthog"`);
    args.push("-c", `model_providers.posthog.name="PostHog Gateway"`);
    args.push("-c", `model_providers.posthog.base_url="${options.apiBaseUrl}"`);
    args.push("-c", `model_providers.posthog.wire_api="responses"`);
    args.push(
      "-c",
      `model_providers.posthog.env_key="POSTHOG_GATEWAY_API_KEY"`,
    );
  }

  if (options.model) {
    args.push("-c", `model="${options.model}"`);
  }

  if (options.reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${options.reasoningEffort}"`);
  }

  if (options.additionalDirectories?.length) {
    const escaped = options.additionalDirectories
      .map((p) => `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
      .join(",");
    args.push("-c", `sandbox_workspace_write.writable_roots=[${escaped}]`);
  }

  if (options.instructions) {
    const escaped = options.instructions
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/"/g, '\\"');
    args.push("-c", `instructions="${escaped}"`);
  }

  return args;
}

function findCodexBinary(options: CodexProcessOptions): {
  command: string;
  args: string[];
} {
  const configArgs = buildConfigArgs(options);

  if (options.binaryPath && existsSync(options.binaryPath)) {
    return { command: options.binaryPath, args: configArgs };
  }

  if (options.binaryPath) {
    throw new Error(
      `codex-acp binary not found at ${options.binaryPath}. Run "node apps/code/scripts/download-binaries.mjs" to download it.`,
    );
  }

  return { command: "npx", args: ["@zed-industries/codex-acp", ...configArgs] };
}

export function spawnCodexProcess(options: CodexProcessOptions): CodexProcess {
  const logger =
    options.logger ?? new Logger({ debug: true, prefix: "[CodexSpawn]" });

  const env: NodeJS.ProcessEnv = { ...process.env };

  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;

  if (options.apiKey) {
    env.POSTHOG_GATEWAY_API_KEY = options.apiKey;
  }

  const { command, args } = findCodexBinary(options);

  if (options.binaryPath && existsSync(options.binaryPath)) {
    const binDir = dirname(options.binaryPath);
    env.PATH = `${binDir}${delimiter}${env.PATH ?? ""}`;
  }

  logger.info("Spawning codex-acp process", {
    command,
    args,
    cwd: options.cwd,
    hasApiBaseUrl: !!options.apiBaseUrl,
    hasApiKey: !!options.apiKey,
    binaryPath: options.binaryPath,
  });

  const child = spawn(command, args, {
    cwd: options.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  child.stderr?.on("data", (data: Buffer) => {
    logger.warn("codex-acp stderr:", data.toString());
  });

  child.on("error", (err) => {
    logger.error("codex-acp process error:", err);
  });

  child.on("exit", (code, signal) => {
    logger.info("codex-acp process exited", { code, signal });
    if (child.pid && options.processCallbacks?.onProcessExited) {
      options.processCallbacks.onProcessExited(child.pid);
    }
  });

  if (!child.stdin || !child.stdout) {
    throw new Error("Failed to get stdio streams from codex-acp process");
  }

  if (child.pid && options.processCallbacks?.onProcessSpawned) {
    options.processCallbacks.onProcessSpawned({
      pid: child.pid,
      command,
    });
  }

  return {
    process: child,
    stdin: child.stdin,
    stdout: child.stdout,
    kill: () => {
      logger.info("Killing codex-acp process", { pid: child.pid });
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.kill("SIGTERM");
    },
  };
}
