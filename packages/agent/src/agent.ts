import {
  createAcpConnection,
  type InProcessAcpConnection,
} from "./adapters/acp-connection";
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_GATEWAY_MODEL,
  fetchModelsList,
  isBlockedModelId,
} from "./gateway-models";
import { PostHogAPIClient, type TaskRunUpdate } from "./posthog-api";
import { SessionLogWriter } from "./session-log-writer";
import type { AgentConfig, TaskExecutionOptions } from "./types";
import { buildGatewayPropertyHeaders } from "./utils/gateway";
import { Logger } from "./utils/logger";

export class Agent {
  private posthogAPI?: PostHogAPIClient;
  private logger: Logger;
  private acpConnection?: InProcessAcpConnection;
  private taskRunId?: string;
  private sessionLogWriter?: SessionLogWriter;
  private posthogApiConfig?: AgentConfig["posthog"];
  private enricherEnabled: boolean;

  constructor(config: AgentConfig) {
    this.logger = new Logger({
      debug: config.debug || false,
      prefix: "[PostHog Agent]",
      onLog: config.onLog,
    });

    if (config.posthog) {
      this.posthogAPI = new PostHogAPIClient(config.posthog);
      this.posthogApiConfig = config.posthog;
    }
    this.enricherEnabled = config.enricher?.enabled !== false;

    if (config.posthog && !config.skipLogPersistence) {
      this.sessionLogWriter = new SessionLogWriter({
        posthogAPI: this.posthogAPI,
        logger: this.logger.child("SessionLogWriter"),
        localCachePath: config.localCachePath,
      });

      if (config.localCachePath) {
        SessionLogWriter.cleanupOldSessions(config.localCachePath).catch(
          () => {},
        );
      }
    }
  }

  private async _configureLlmGateway(overrideUrl?: string): Promise<{
    gatewayUrl: string;
    apiKey: string;
  } | null> {
    if (!this.posthogAPI) {
      return null;
    }

    try {
      const gatewayUrl = overrideUrl ?? this.posthogAPI.getLlmGatewayUrl();
      const apiKey = await this.posthogAPI.getApiKey();

      process.env.OPENAI_BASE_URL = `${gatewayUrl}/v1`;
      process.env.OPENAI_API_KEY = apiKey;
      process.env.ANTHROPIC_BASE_URL = gatewayUrl;
      process.env.ANTHROPIC_AUTH_TOKEN = apiKey;

      // Attribute every captured $ai_generation event to this team. The gateway
      // authenticates with a shared key, so without the `team_id` property the
      // spend lands on the key owner's team. Forwarded as an
      // `x-posthog-property-team_id` header that the gateway lifts onto the
      // event (the Claude session builder appends its own headers to this in
      // adapters/claude/session/options.ts). Mirrors the cloud path in
      // server/agent-server.ts and django's get_llm_client(team_id=...).
      this._applyGatewayPropertyHeaders({
        team_id: this.posthogAPI.getProjectId(),
      });

      return { gatewayUrl, apiKey };
    } catch (error) {
      this.logger.error("Failed to configure LLM gateway", error);
      throw error;
    }
  }

  /**
   * Merge `x-posthog-property-*` header lines into `ANTHROPIC_CUSTOM_HEADERS`,
   * deduping by header name so re-configuring across sessions doesn't append
   * the same property twice. Existing non-property lines are preserved.
   */
  private _applyGatewayPropertyHeaders(
    properties: Record<string, string | number | boolean | null | undefined>,
  ): void {
    const lines = new Map<string, string>();
    const existing = process.env.ANTHROPIC_CUSTOM_HEADERS;
    if (existing) {
      for (const line of existing.split("\n")) {
        const name = line.slice(0, line.indexOf(":")).trim();
        if (name) {
          lines.set(name, line);
        }
      }
    }

    const additions = buildGatewayPropertyHeaders(properties);
    if (additions) {
      for (const line of additions.split("\n")) {
        const name = line.slice(0, line.indexOf(":")).trim();
        lines.set(name, line);
      }
    }

    process.env.ANTHROPIC_CUSTOM_HEADERS = Array.from(lines.values()).join(
      "\n",
    );
  }

  async run(
    taskId: string,
    taskRunId: string,
    options: TaskExecutionOptions = {},
  ): Promise<InProcessAcpConnection> {
    const gatewayConfig = await this._configureLlmGateway(options.gatewayUrl);
    this.taskRunId = taskRunId;

    let allowedModelIds: Set<string> | undefined;
    let sanitizedModel =
      options.model && !isBlockedModelId(options.model)
        ? options.model
        : undefined;
    if (options.adapter === "codex" && gatewayConfig) {
      const models = await fetchModelsList({
        gatewayUrl: gatewayConfig.gatewayUrl,
      });
      const codexModelIds = models
        .filter((model) => {
          if (isBlockedModelId(model.id)) return false;
          if (model.owned_by) {
            return model.owned_by === "openai";
          }
          return model.id.startsWith("gpt-") || model.id.startsWith("openai/");
        })
        .map((model) => model.id);

      if (codexModelIds.length > 0) {
        allowedModelIds = new Set(codexModelIds);
      }

      if (!sanitizedModel || !allowedModelIds?.has(sanitizedModel)) {
        sanitizedModel = codexModelIds.includes(DEFAULT_CODEX_MODEL)
          ? DEFAULT_CODEX_MODEL
          : codexModelIds[0];
      }
    }
    if (!sanitizedModel && options.adapter !== "codex") {
      sanitizedModel = DEFAULT_GATEWAY_MODEL;
    }

    this.acpConnection = createAcpConnection({
      adapter: options.adapter,
      logWriter: this.sessionLogWriter,
      taskRunId,
      taskId,
      deviceType: "local",
      logger: this.logger,
      processCallbacks: options.processCallbacks,
      onStructuredOutput: options.onStructuredOutput,
      allowedModelIds,
      posthogApiConfig: this.posthogApiConfig,
      enricherEnabled: this.enricherEnabled,
      codexOptions:
        options.adapter === "codex" && gatewayConfig
          ? {
              cwd: options.repositoryPath,
              apiBaseUrl: `${gatewayConfig.gatewayUrl}/v1`,
              apiKey: gatewayConfig.apiKey,
              binaryPath: options.codexBinaryPath,
              model: sanitizedModel,
              instructions: options.instructions,
              additionalDirectories: options.additionalDirectories,
            }
          : undefined,
    });

    return this.acpConnection;
  }

  async attachPullRequestToTask(
    taskId: string,
    prUrl: string,
    branchName?: string,
  ): Promise<void> {
    this.logger.info("Attaching PR to task run", { taskId, prUrl, branchName });

    if (!this.posthogAPI || !this.taskRunId) {
      const error = new Error(
        "PostHog API not configured or no active run. Cannot attach PR to task.",
      );
      this.logger.error("PostHog API not configured", error);
      throw error;
    }

    const updates: TaskRunUpdate = {
      output: { pr_url: prUrl },
    };
    if (branchName) {
      updates.branch = branchName;
    }

    await this.posthogAPI.updateTaskRun(taskId, this.taskRunId, updates);
    this.logger.debug("PR attached to task run", {
      taskId,
      taskRunId: this.taskRunId,
      prUrl,
    });
  }

  getPosthogAPI(): PostHogAPIClient | undefined {
    return this.posthogAPI;
  }

  async flushAllLogs(): Promise<void> {
    await this.sessionLogWriter?.flushAll();
  }

  async cleanup(): Promise<void> {
    if (this.sessionLogWriter && this.taskRunId) {
      await this.sessionLogWriter.flush(this.taskRunId, { coalesce: true });
    }
    await this.acpConnection?.cleanup();
  }
}
