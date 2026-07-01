import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { ProcessSpawnedCallback } from "../../types";
import { Logger } from "../../utils/logger";
import { CodexSettingsManager } from "../codex/settings";

export interface CodexAppServerProcessOptions {
  /** Path to the native `codex` CLI binary (the one that exposes `app-server`). */
  binaryPath: string;
  cwd?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  /** Guidance appended to Codex's base prompt via `developer_instructions`. */
  developerInstructions?: string;
  /** Extra codex `-c key=value` config overrides (e.g. auto_compact_token_limit). */
  configOverrides?: Record<string, string | number>;
  logger?: Logger;
  processCallbacks?: ProcessSpawnedCallback;
}

export interface CodexAppServerProcess {
  process: ChildProcess;
  stdin: Writable;
  stdout: Readable;
  kill: () => void;
}

export function buildAppServerArgs(
  options: CodexAppServerProcessOptions,
): string[] {
  const args: string[] = ["app-server"];

  args.push("-c", "features.remote_models=false");

  // OS sandbox mode is gated on the platform, which mirrors sandbox AVAILABILITY:
  //  - macOS (local desktop + e2e): Seatbelt is available, so spawn with the
  //    `workspace-write` sandbox. This keeps the OS sandbox engaged so a per-turn
  //    `sandboxPolicy:readOnly` (the Plan / Read-only presets) can actually
  //    TIGHTEN it and block edits — a process spawned `danger-full-access` has
  //    the sandbox fully disabled and can't re-engage it per-turn, which made the
  //    mode picker cosmetic.
  //  - cloud (linux containers): codex's `linux-sandbox` launcher is unavailable,
  //    so the default mode panics ("sandbox launcher unavailable") and wedges the
  //    session. Run `danger-full-access` (PostHog's enclosing docker/Modal
  //    sandbox provides the real isolation there). Windows falls here too,
  //    conservatively, until its sandbox is verified.
  args.push(
    "-c",
    process.platform === "darwin"
      ? `sandbox_mode="workspace-write"`
      : `sandbox_mode="danger-full-access"`,
  );

  // Disable the user's ambient ~/.codex MCP servers (linear/figma/etc.) so the
  // adapter only exposes MCP servers PostHog Code injects per-thread — matching
  // the codex-acp adapter. Without this, codex tries (and fails) to connect to
  // the user's local MCP servers, polluting the session. Only the first key
  // segment is disabled (`mcp_servers.<name>.enabled=false`) — see settings.ts.
  for (const name of new CodexSettingsManager(
    options.cwd ?? process.cwd(),
  ).getSettings().mcpServerNames) {
    // codex's `-c` parser rejects quoted/special key segments; a dotted or
    // spaced server name would emit an override that fails to load and wedges
    // the whole session. Skip it (the server stays enabled, which is harmless)
    // — mirrors the guard in codex/spawn.ts.
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

  // developer_instructions are set per-thread in thread/start (combined with the
  // host's task system prompt) rather than as a spawn-level global default, so
  // the task prompt — only known at newSession — reaches the model too.

  // Caller-supplied config overrides (e.g. the e2e's low auto_compact_token_limit).
  // Numbers/bools go bare; strings are quoted, matching codex's `-c` parser.
  for (const [key, value] of Object.entries(options.configOverrides ?? {})) {
    args.push(
      "-c",
      `${key}=${typeof value === "number" ? value : `"${value}"`}`,
    );
  }

  return args;
}

export function spawnCodexAppServerProcess(
  options: CodexAppServerProcessOptions,
): CodexAppServerProcess {
  const logger =
    options.logger ?? new Logger({ debug: true, prefix: "[CodexAppServer]" });

  if (!existsSync(options.binaryPath)) {
    throw new Error(
      `codex binary not found at ${options.binaryPath}. Run "node apps/code/scripts/download-binaries.mjs" to download it.`,
    );
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  if (options.apiKey) {
    env.POSTHOG_GATEWAY_API_KEY = options.apiKey;
  }
  env.PATH = `${dirname(options.binaryPath)}${delimiter}${env.PATH ?? ""}`;

  const args = buildAppServerArgs(options);

  logger.info("Spawning codex app-server process", {
    command: options.binaryPath,
    args,
    cwd: options.cwd,
  });

  const child = spawn(options.binaryPath, args, {
    cwd: options.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  child.stderr?.on("data", (data: Buffer) => {
    logger.warn("codex app-server stderr:", data.toString());
  });

  child.on("error", (err) => {
    logger.error("codex app-server process error:", err);
  });

  child.on("exit", (code, signal) => {
    logger.info("codex app-server process exited", { code, signal });
    if (child.pid && options.processCallbacks?.onProcessExited) {
      options.processCallbacks.onProcessExited(child.pid);
    }
  });

  if (!child.stdin || !child.stdout) {
    throw new Error(
      "Failed to get stdio streams from codex app-server process",
    );
  }

  if (child.pid && options.processCallbacks?.onProcessSpawned) {
    options.processCallbacks.onProcessSpawned({
      pid: child.pid,
      command: options.binaryPath,
    });
  }

  return {
    process: child,
    stdin: child.stdin,
    stdout: child.stdout,
    kill: () => {
      logger.info("Killing codex app-server process", { pid: child.pid });
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.kill("SIGTERM");
    },
  };
}
