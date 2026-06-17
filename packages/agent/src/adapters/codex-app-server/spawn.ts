import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { ProcessSpawnedCallback } from "../../types";
import { Logger } from "../../utils/logger";

export interface CodexAppServerProcessOptions {
  /** Path to the native `codex` CLI binary (the one that exposes `app-server`). */
  binaryPath: string;
  cwd?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  /** Guidance appended to Codex's base prompt via `developer_instructions`. */
  developerInstructions?: string;
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
