import {
  createAcpConnection,
  type InProcessAcpConnection,
} from "./adapters/acp-connection";
import {
  BLOCKED_MODELS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_GATEWAY_MODEL,
  fetchModelsList,
} from "./gateway-models";
import { PostHogAPIClient, type TaskRunUpdate } from "./posthog-api";
import { SessionLogWriter } from "./session-log-writer";
import type { AgentConfig, TaskExecutionOptions } from "./types";
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

      return { gatewayUrl, apiKey };
    } catch (error) {
      this.logger.error("Failed to configure LLM gateway", error);
      throw error;
    }
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
      options.model && !BLOCKED_MODELS.has(options.model)
        ? options.model
        : undefined;
    if (options.adapter === "codex" && gatewayConfig) {
      const models = await fetchModelsList({
        gatewayUrl: gatewayConfig.gatewayUrl,
      });
      const codexModelIds = models
        .filter((model) => {
          if (BLOCKED_MODELS.has(model.id)) return false;
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
