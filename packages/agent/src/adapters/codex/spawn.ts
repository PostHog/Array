import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { ProcessSpawnedCallback } from "../../types";
import { Logger } from "../../utils/logger";
import { stripElectronNodeShimFromPath } from "../../utils/spawn-env";
import type { CodexSettings } from "./settings";

export interface CodexProcessOptions {
  cwd?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  reasoningEffort?: string;
  /**
   * Guidance appended on top of Codex's model-optimized base prompt via the
   * `developer_instructions` config key. Unlike `instructions` /
   * `model_instructions_file`, this does not replace the native base prompt.
   */
  developerInstructions?: string;
  binaryPath?: string;
  codexHome?: string;
  logger?: Logger;
  processCallbacks?: ProcessSpawnedCallback;
  settings?: CodexSettings;
  /** Additional writable roots passed to Codex's workspace-write sandbox. */
  additionalDirectories?: string[];
  /**
   * Extra codex `-c key=value` config overrides (app-server sub-adapter only).
   * An escape hatch for config the adapter doesn't model — e.g. the e2e sets
   * `auto_compact_token_limit` low to force a compaction.
   */
  configOverrides?: Record<string, string | number>;
  /** Deployment environment; "cloud" disables codex's own OS sandbox (the enclosing sandbox isolates). */
  environment?: "local" | "cloud";
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

  // On cloud the agent already runs inside PostHog's isolated sandbox (docker/Modal
  // with agentsh egress + filesystem controls), so Codex's own OS-level sandbox is
  // redundant — and its `linux-sandbox` launcher is unavailable inside that
  // sandbox, so the default workspace-write mode panics ("sandbox launcher
  // unavailable" → require_escalated) and wedges the session. Run Codex with no
  // nested sandbox there; the enclosing sandbox provides the isolation. Local
  // desktop sessions keep codex's own sandbox as the OS-level backstop.
  if (options.environment === "cloud") {
    args.push("-c", `sandbox_mode="danger-full-access"`);
  }

  // Disable the user's local MCPs one-by-one so Codex only uses the MCPs we
  // provide via ACP. We can't use `-c mcp_servers={}` because that makes Codex
  // ignore MCPs entirely, including the ones we inject later.
  //
  // Only bare-key names are emitted: codex's `-c` parser rejects quoted key
  // segments, so a name with a dot or other special character cannot be
  // expressed as `mcp_servers.<name>.enabled=false` without producing an
  // override that fails to load and crashes the whole codex session. Skipping
  // such a name leaves that server enabled (harmless) instead of killing codex.
  for (const name of options.settings?.mcpServerNames ?? []) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) continue;
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

  if (options.developerInstructions) {
    const escaped = options.developerInstructions
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/"/g, '\\"');
    args.push("-c", `developer_instructions="${escaped}"`);
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

  if (options.codexHome) {
    env.CODEX_HOME = options.codexHome;
  }

  const { command, args } = findCodexBinary(options);

  env.PATH = stripElectronNodeShimFromPath(env.PATH);
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
