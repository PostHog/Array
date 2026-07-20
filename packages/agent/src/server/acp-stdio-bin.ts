#!/usr/bin/env node
/**
 * ACP-over-stdio sidecar for the Rust agent-server (phase 1 of the Rust
 * rewrite — see rust/README.md in this repo).
 *
 * Runs the existing in-process ACP agents (ClaudeAcpAgent / codex app-server
 * proxy) with the ACP byte streams wired to this process's stdin/stdout
 * instead of an in-memory pair. The Rust server owns everything that used to
 * wrap these streams — HTTP/SSE, JWT, event ingest, session log persistence —
 * so this entry is deliberately thin: no HTTP, no tapping, no log writer.
 *
 * Configuration arrives as JSON in POSTHOG_SIDECAR_CONFIG (set by the Rust
 * server's adapter spawner — rust/crates/agent-server/src/adapter.rs).
 */

// stdout is the ACP protocol channel. The package's Logger writes through
// console[level], and console.log/info/debug write to stdout — rebind them
// to stderr before any module can construct a Logger.
// biome-ignore lint/suspicious/noConsole: stdout carries the ACP stream
console.log = console.error.bind(console);
// biome-ignore lint/suspicious/noConsole: stdout carries the ACP stream
console.info = console.error.bind(console);
// biome-ignore lint/suspicious/noConsole: stdout carries the ACP stream
console.debug = console.error.bind(console);
// biome-ignore lint/suspicious/noConsole: stdout carries the ACP stream
console.warn = console.error.bind(console);

import { Readable, Writable } from "node:stream";
import { z } from "zod/v4";
import { createAcpConnection } from "../adapters/acp-connection";
import type { GatewayEnv } from "../adapters/claude/session/options";

const gatewayEnvSchema = z.object({
  anthropicBaseUrl: z.string(),
  anthropicAuthToken: z.string(),
  openaiBaseUrl: z.string(),
  openaiApiKey: z.string(),
  anthropicCustomHeaders: z.string(),
  posthogProjectId: z.string(),
});

const sidecarConfigSchema = z.object({
  taskId: z.string(),
  taskRunId: z.string(),
  deviceType: z.enum(["local", "cloud"]).default("cloud"),
  adapter: z.enum(["claude", "codex"]).default("claude"),
  gatewayEnv: gatewayEnvSchema.optional(),
  posthogApiConfig: z
    .object({
      apiUrl: z.string(),
      projectId: z.number(),
    })
    .optional(),
  codexOptions: z
    .object({
      cwd: z.string().optional(),
      model: z.string().optional(),
      reasoningEffort: z
        .enum(["low", "medium", "high", "xhigh", "max"])
        .optional(),
      developerInstructions: z.string().optional(),
    })
    .optional(),
});

function fail(message: string): never {
  // biome-ignore lint/suspicious/noConsole: startup diagnostics go to stderr
  console.error(`[acp-stdio] ${message}`);
  process.exit(1);
}

const rawConfig = process.env.POSTHOG_SIDECAR_CONFIG;
if (!rawConfig) {
  fail("POSTHOG_SIDECAR_CONFIG is required");
}

let parsedConfig: unknown;
try {
  parsedConfig = JSON.parse(rawConfig);
} catch {
  fail("POSTHOG_SIDECAR_CONFIG must be valid JSON");
}

const configResult = sidecarConfigSchema.safeParse(parsedConfig);
if (!configResult.success) {
  fail(
    `POSTHOG_SIDECAR_CONFIG validation failed: ${configResult.error.message}`,
  );
}
const config = configResult.data;

const apiKey =
  process.env.POSTHOG_API_KEY ?? process.env.POSTHOG_PERSONAL_API_KEY;

const connection = createAcpConnection({
  adapter: config.adapter,
  taskId: config.taskId,
  taskRunId: config.taskRunId,
  deviceType: config.deviceType,
  // No logWriter: the Rust server taps the stdio stream and persists logs.
  claudeGatewayEnv:
    config.adapter === "claude"
      ? (config.gatewayEnv as GatewayEnv | undefined)
      : undefined,
  posthogApiConfig:
    config.posthogApiConfig && apiKey
      ? {
          apiUrl: config.posthogApiConfig.apiUrl,
          projectId: config.posthogApiConfig.projectId,
          getApiKey: () => apiKey,
        }
      : undefined,
  // The enricher's tree-sitter WASM grammars aren't bundled into this CJS
  // entry yet; loading them crashes at startup (ERR_INVALID_ARG_TYPE in
  // createEnrichment). Keep file-read enrichment off under the Rust server
  // until the assets ship next to the bundle.
  enricherEnabled: false,
  codexOptions:
    config.adapter === "codex"
      ? {
          cwd: config.codexOptions?.cwd ?? "/tmp/workspace",
          apiBaseUrl: config.gatewayEnv?.openaiBaseUrl,
          apiKey,
          binaryPath: process.env.POSTHOG_CODEX_BINARY_PATH,
          model: config.codexOptions?.model,
          reasoningEffort: config.codexOptions?.reasoningEffort,
          developerInstructions: config.codexOptions?.developerInstructions,
        }
      : undefined,
  // Structured output flows to the host as an ACP extension notification;
  // the Rust server persists it via the set_output API.
  onStructuredOutput: async (output) => {
    connection.agentConnection?.extNotification("_posthog/structured_output", {
      output,
    });
  },
});

const stdinWeb = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
const stdoutWeb = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;

// agent → host
connection.clientStreams.readable.pipeTo(stdoutWeb).catch((error) => {
  // biome-ignore lint/suspicious/noConsole: pipe diagnostics go to stderr
  console.error("[acp-stdio] stdout pipe failed", error);
});

// host → agent; stdin EOF is the shutdown signal from the Rust server.
stdinWeb
  .pipeTo(connection.clientStreams.writable)
  .catch(() => undefined)
  .finally(() => {
    void connection
      .cleanup()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
