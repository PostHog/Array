#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { z } from "zod/v4";
import { isSupportedReasoningEffort } from "../adapters/reasoning-effort";
import { DEFAULT_POSTHOG_EXEC_PERMISSION_REGEX_SOURCE } from "../posthog-exec-permission";
import { AgentServer } from "./agent-server";
import { PiAgentServer } from "./pi-agent-server";
import {
  claudeCodeConfigSchema,
  mcpServersSchema,
  posthogExecPermissionRegexSchema,
  relayMcpServerNamesSchema,
} from "./schemas";
import type { AgentServerConfig } from "./types";

const envSchema = z.object({
  JWT_PUBLIC_KEY: z
    .string({
      error: "JWT_PUBLIC_KEY is required for authenticating client connections",
    })
    .min(1, "JWT_PUBLIC_KEY cannot be empty"),
  POSTHOG_API_URL: z.url({
    error: "POSTHOG_API_URL is required for LLM gateway communication",
  }),
  POSTHOG_PERSONAL_API_KEY: z
    .string({
      error:
        "POSTHOG_PERSONAL_API_KEY is required for authenticating with PostHog services",
    })
    .min(1, "POSTHOG_PERSONAL_API_KEY cannot be empty"),
  POSTHOG_PROJECT_ID: z
    .string({
      error:
        "POSTHOG_PROJECT_ID is required for routing requests to the correct project",
    })
    .regex(/^\d+$/, "POSTHOG_PROJECT_ID must be a numeric string")
    .transform((val) => parseInt(val, 10)),
  POSTHOG_AGENT_PROTOCOL: z.enum(["acp", "pi"]).optional(),
  POSTHOG_SANDBOX_ID: z.string().min(1).optional(),
  POSTHOG_CODE_RUNTIME_ADAPTER: z.enum(["claude", "codex"]).optional(),
  POSTHOG_CODE_MODEL: z.string().optional(),
  POSTHOG_CODE_REASONING_EFFORT: z
    .enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
    .optional(),
  POSTHOG_AGENT_STATE_DIR: z.string().startsWith("/").optional(),
  POSTHOG_TASK_RUN_EVENT_INGEST_TOKEN: z.string().min(1).optional(),
  // Base URL for the event-ingest POST only; falls back to POSTHOG_API_URL when unset.
  POSTHOG_TASK_RUN_EVENT_INGEST_URL: z.url().optional(),
  POSTHOG_TASK_RUN_EVENT_INGEST_STREAM_WINDOW_MS: z
    .string()
    .regex(
      /^[1-9]\d*$/,
      "POSTHOG_TASK_RUN_EVENT_INGEST_STREAM_WINDOW_MS must be a positive integer",
    )
    .transform((value) => parseInt(value, 10))
    .optional(),
  POSTHOG_TASK_RUN_EVENT_INGEST_KEEP_STREAM_OPEN: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

const program = new Command();

function parseBooleanOption(
  raw: string | undefined,
  flag: string,
): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  program.error(`${flag} must be either "true" or "false"`);
}

function parseJsonOption<S extends z.ZodType>(
  raw: string | undefined,
  schema: S,
  flag: string,
): z.output<S> | undefined {
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    program.error(`${flag} must be valid JSON`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    program.error(`${flag} validation failed:\n${errors}`);
  }
  return result.data;
}

function parseStringOption(
  raw: string | undefined,
  schema: z.ZodType<string>,
  flag: string,
): string | undefined {
  if (raw === undefined) return undefined;

  const result = schema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.message}`)
      .join("\n");
    program.error(`${flag} validation failed:\n${errors}`);
  }
  return result.data;
}

program
  .name("agent-server")
  .description("PostHog cloud agent server - runs in sandbox environments")
  .option("--port <port>", "HTTP server port", "3001")
  .option(
    "--mode <mode>",
    "Execution mode: interactive or background",
    "interactive",
  )
  .option("--repositoryPath <path>", "Path to the repository")
  .option(
    "--repoReadyFile <path>",
    "Sentinel file; session creation blocks until it exists (set while cloning concurrently)",
  )
  .requiredOption("--taskId <id>", "Task ID")
  .requiredOption("--runId <id>", "Task run ID")
  .option(
    "--mcpServers <json>",
    "MCP servers config as JSON array (ACP McpServer[] format)",
  )
  .option(
    "--relayMcpServers <json>",
    "Desktop-relayed MCP server names as JSON array (docs/cloud-mcp-relay.md)",
  )
  .option(
    "--posthogExecPermissionRegex <regex>",
    "Case-insensitive regex for PostHog exec sub-tools that require client approval",
    DEFAULT_POSTHOG_EXEC_PERMISSION_REGEX_SOURCE,
  )
  .option("--createPr <boolean>", "Whether this run may publish changes")
  .option(
    "--autoPublish <boolean>",
    "Whether this run should push and open a draft PR on completion without an explicit ask",
  )
  .option("--baseBranch <branch>", "Base branch for PR creation")
  .option(
    "--claudeCodeConfig <json>",
    "Claude Code config as JSON (systemPrompt, systemPromptAppend, plugins)",
  )
  .option(
    "--allowedDomains <domains>",
    "Comma-separated list of domains allowed for web tools (WebFetch, WebSearch)",
  )
  .action(async (options) => {
    const envResult = envSchema.safeParse(process.env);

    if (!envResult.success) {
      const errors = envResult.error.issues
        .map((issue) => `  - ${issue.message}`)
        .join("\n");
      program.error(`Environment validation failed:\n${errors}`);
      return;
    }

    const env = envResult.data;

    const mode = options.mode === "background" ? "background" : "interactive";
    const createPr = parseBooleanOption(options.createPr, "--createPr");
    const autoPublish = parseBooleanOption(
      options.autoPublish,
      "--autoPublish",
    );

    const mcpServers = parseJsonOption(
      options.mcpServers,
      mcpServersSchema,
      "--mcpServers",
    );
    const relayMcpServers = parseJsonOption(
      options.relayMcpServers,
      relayMcpServerNamesSchema,
      "--relayMcpServers",
    );
    const posthogExecPermissionRegex = parseStringOption(
      options.posthogExecPermissionRegex,
      posthogExecPermissionRegexSchema,
      "--posthogExecPermissionRegex",
    );
    const claudeCode = parseJsonOption(
      options.claudeCodeConfig,
      claudeCodeConfigSchema,
      "--claudeCodeConfig",
    );

    const allowedDomains = options.allowedDomains
      ? options.allowedDomains
          .split(",")
          .map((d: string) => d.trim())
          .filter(Boolean)
      : undefined;

    if (
      env.POSTHOG_CODE_RUNTIME_ADAPTER &&
      env.POSTHOG_CODE_MODEL &&
      env.POSTHOG_CODE_REASONING_EFFORT &&
      !isSupportedReasoningEffort(
        env.POSTHOG_CODE_RUNTIME_ADAPTER,
        env.POSTHOG_CODE_MODEL,
        env.POSTHOG_CODE_REASONING_EFFORT,
      )
    ) {
      program.error(
        `POSTHOG_CODE_REASONING_EFFORT '${env.POSTHOG_CODE_REASONING_EFFORT}' is not supported for ${env.POSTHOG_CODE_RUNTIME_ADAPTER} model '${env.POSTHOG_CODE_MODEL}'.`,
      );
    }

    const serverConfig: AgentServerConfig = {
      port: parseInt(options.port, 10),
      agentStateDir: env.POSTHOG_AGENT_STATE_DIR,
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      eventIngestToken: env.POSTHOG_TASK_RUN_EVENT_INGEST_TOKEN,
      eventIngestBaseUrl: env.POSTHOG_TASK_RUN_EVENT_INGEST_URL,
      eventIngestStreamWindowMs:
        env.POSTHOG_TASK_RUN_EVENT_INGEST_STREAM_WINDOW_MS,
      eventIngestKeepStreamOpen:
        env.POSTHOG_TASK_RUN_EVENT_INGEST_KEEP_STREAM_OPEN,
      repositoryPath: options.repositoryPath,
      repoReadyFile: options.repoReadyFile,
      apiUrl: env.POSTHOG_API_URL,
      apiKey: env.POSTHOG_PERSONAL_API_KEY,
      projectId: env.POSTHOG_PROJECT_ID,
      mode,
      taskId: options.taskId,
      runId: options.runId,
      sandboxId: env.POSTHOG_SANDBOX_ID,
      createPr,
      autoPublish,
      mcpServers,
      relayMcpServers,
      posthogExecPermissionRegex,
      baseBranch: options.baseBranch,
      claudeCode,
      allowedDomains,
      protocol: env.POSTHOG_AGENT_PROTOCOL,
      piRpcHostPath: resolve(
        dirname(realpathSync(process.argv[1])),
        "../pi/rpc-host.js",
      ),
      runtimeAdapter: env.POSTHOG_CODE_RUNTIME_ADAPTER,
      model: env.POSTHOG_CODE_MODEL,
      reasoningEffort: env.POSTHOG_CODE_REASONING_EFFORT,
    };
    const server =
      env.POSTHOG_AGENT_PROTOCOL === "pi"
        ? new PiAgentServer(serverConfig)
        : new AgentServer(serverConfig);

    process.on("SIGINT", async () => {
      await server.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await server.stop();
      process.exit(0);
    });

    // Mark the run failed before exiting so a hard crash surfaces a real error instead of a
    // silent stall. The deadline guarantees we exit even if the report hangs at crash time.
    const FATAL_ERROR_REPORT_DEADLINE_MS = 5_000;
    const handleFatalError = async (error: unknown) => {
      try {
        await Promise.race([
          server.reportFatalError(error),
          new Promise((resolve) =>
            setTimeout(resolve, FATAL_ERROR_REPORT_DEADLINE_MS).unref(),
          ),
        ]);
      } finally {
        process.exit(1);
      }
    };
    process.on("uncaughtException", handleFatalError);
    process.on("unhandledRejection", handleFatalError);

    await server.start();
  });

program.parse();
