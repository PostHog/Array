import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type { SessionLogWriter } from "../session-log-writer";
import type { PostHogAPIConfig, ProcessSpawnedCallback } from "../types";
import { Logger } from "../utils/logger";
import {
  createBidirectionalStreams,
  createTappedWritableStream,
  type StreamPair,
} from "../utils/streams";
import { ClaudeAcpAgent } from "./claude/claude-agent";
import type { GatewayEnv } from "./claude/session/options";
import { CodexAcpAgent } from "./codex/codex-agent";
import type { CodexProcessOptions } from "./codex/spawn";
import { nativeCodexBinaryPath } from "./codex-app-server/binary-path";
import { CodexAppServerAgent } from "./codex-app-server/codex-app-server-agent";

type AgentAdapter = "claude" | "codex";

export type AcpConnectionConfig = {
  adapter?: AgentAdapter;
  logWriter?: SessionLogWriter;
  taskRunId?: string;
  taskId?: string;
  /** Deployment environment - "local" for desktop, "cloud" for cloud sandbox */
  deviceType?: "local" | "cloud";
  logger?: Logger;
  processCallbacks?: ProcessSpawnedCallback;
  codexOptions?: CodexProcessOptions;
  allowedModelIds?: Set<string>;
  /**
   * Feature-flag lever for the codex sub-adapter, passed by the host from the
   * `codex-app-server` PostHog flag (gradual rollout / kill-switch). `true` =>
   * native app-server, `false` => codex-acp. When undefined, falls back to env
   * overrides then the default (codex-acp). Lets app-server roll out alongside
   * codex-acp without a code change.
   */
  useCodexAppServer?: boolean;
  /** Callback invoked when the agent calls the create_output tool for structured output */
  onStructuredOutput?: (output: Record<string, unknown>) => Promise<void>;
  /** PostHog API config; when set, enables file-read enrichment unless disabled. */
  posthogApiConfig?: PostHogAPIConfig;
  /** Defaults to true when posthogApiConfig is set. Set to false to disable enrichment. */
  enricherEnabled?: boolean;
  /** Explicit gateway config for the Claude adapter — prevents global process.env mutation. */
  claudeGatewayEnv?: GatewayEnv;
};

export type AcpConnection = {
  agentConnection?: AgentSideConnection;
  clientStreams: StreamPair;
  cleanup: () => Promise<void>;
};

export type InProcessAcpConnection = AcpConnection;

/**
 * Creates an ACP connection with the specified agent framework.
 *
 * @param config - Configuration including framework selection
 * @returns Connection with agent and client streams
 */
export function createAcpConnection(
  config: AcpConnectionConfig = {},
): AcpConnection {
  const adapterType = config.adapter ?? "claude";

  if (adapterType === "codex") {
    return createCodexConnection(config);
  }

  return createClaudeConnection(config);
}

function resolveEnricherApiConfig(
  config: AcpConnectionConfig,
): PostHogAPIConfig | undefined {
  const enabled = !!config.posthogApiConfig && config.enricherEnabled !== false;
  return enabled ? config.posthogApiConfig : undefined;
}

/**
 * Resolves which codex sub-adapter to use. Precedence: host flag
 * (`config.useCodexAppServer`, from the `codex-app-server` PostHog flag) > env
 * overrides (`POSTHOG_CODEX_USE_APP_SERVER=1` / `POSTHOG_CODEX_USE_ACP=1`) >
 * default (codex-acp, the proven fallback). The native app-server is opt-in:
 * the host turns it on per-user via the flag (cloud passes the resolved env;
 * desktop passes `useCodexAppServer`), so it can roll out alongside codex-acp
 * without a code change and be killed instantly by flipping the flag off.
 */
export function resolveUseCodexAppServer(config: AcpConnectionConfig): boolean {
  if (typeof config.useCodexAppServer === "boolean") {
    return config.useCodexAppServer;
  }
  if (process.env.POSTHOG_CODEX_USE_APP_SERVER === "1") return true;
  if (process.env.POSTHOG_CODEX_USE_ACP === "1") return false;
  return false;
}

function createClaudeConnection(config: AcpConnectionConfig): AcpConnection {
  const logger =
    config.logger?.child("AcpConnection") ??
    new Logger({ debug: true, prefix: "[AcpConnection]" });
  const streams = createBidirectionalStreams();

  const { logWriter } = config;

  let agentWritable = streams.agent.writable;
  let clientWritable = streams.client.writable;

  if (config.taskRunId && logWriter) {
    if (!logWriter.isRegistered(config.taskRunId)) {
      logWriter.register(config.taskRunId, {
        taskId: config.taskId ?? config.taskRunId,
        runId: config.taskRunId,
        deviceType: config.deviceType,
      });
    }

    const taskRunId = config.taskRunId;
    agentWritable = createTappedWritableStream(streams.agent.writable, {
      onMessage: (line) => {
        logWriter.appendRawLine(taskRunId, line);
      },
      logger,
    });

    clientWritable = createTappedWritableStream(streams.client.writable, {
      onMessage: (line) => {
        logWriter.appendRawLine(taskRunId, line);
      },
      logger,
    });
  } else {
    logger.info("Tapped streams NOT enabled", {
      hasTaskRunId: !!config.taskRunId,
      hasLogWriter: !!logWriter,
    });
  }

  const agentStream = ndJsonStream(agentWritable, streams.agent.readable);

  let agent: ClaudeAcpAgent | null = null;
  const agentConnection = new AgentSideConnection((client) => {
    agent = new ClaudeAcpAgent(client, {
      ...config.processCallbacks,
      onStructuredOutput: config.onStructuredOutput,
      posthogApiConfig: resolveEnricherApiConfig(config),
      gatewayEnv: config.claudeGatewayEnv,
    });
    return agent;
  }, agentStream);

  return {
    agentConnection,
    clientStreams: {
      readable: streams.client.readable,
      writable: clientWritable,
    },
    cleanup: async () => {
      logger.info("Cleaning up ACP connection");

      if (agent) {
        await agent.closeSession();
      }

      try {
        await streams.client.writable.close();
      } catch {
        // Stream may already be closed
      }
      try {
        await streams.agent.writable.close();
      } catch {
        // Stream may already be closed
      }
    },
  };
}

/**
 * Creates an ACP connection to codex-acp via an in-process proxy agent.
 *
 * The CodexAcpAgent implements the ACP Agent interface and delegates to
 * the codex-acp binary over a ClientSideConnection. This replaces the
 * previous raw stream transform approach and gives us proper interception
 * points for PostHog-specific features.
 */
function createCodexConnection(config: AcpConnectionConfig): AcpConnection {
  const logger =
    config.logger?.child("CodexConnection") ??
    new Logger({ debug: true, prefix: "[CodexConnection]" });

  const { logWriter } = config;

  // Create bidirectional streams for client ↔ agent communication
  const streams = createBidirectionalStreams();

  let agentWritable = streams.agent.writable;
  let clientWritable = streams.client.writable;

  // Tap streams for session log writing
  if (config.taskRunId && logWriter) {
    if (!logWriter.isRegistered(config.taskRunId)) {
      logWriter.register(config.taskRunId, {
        taskId: config.taskId ?? config.taskRunId,
        runId: config.taskRunId,
        deviceType: config.deviceType,
      });
    }

    const taskRunId = config.taskRunId;
    agentWritable = createTappedWritableStream(streams.agent.writable, {
      onMessage: (line) => {
        logWriter.appendRawLine(taskRunId, line);
      },
      logger,
    });

    clientWritable = createTappedWritableStream(streams.client.writable, {
      onMessage: (line) => {
        logWriter.appendRawLine(taskRunId, line);
      },
      logger,
    });
  } else {
    logger.info("Tapped streams NOT enabled for Codex", {
      hasTaskRunId: !!config.taskRunId,
      hasLogWriter: !!logWriter,
    });
  }

  const agentStream = ndJsonStream(agentWritable, streams.agent.readable);

  let agent: CodexAcpAgent | CodexAppServerAgent | null = null;
  const agentConnection = new AgentSideConnection((client) => {
    const codexOptions = config.codexOptions ?? {};
    const nativeBinary = nativeCodexBinaryPath(codexOptions.binaryPath);

    // Use the native app-server when its binary is bundled AND the host (flag)
    // / env selects it. See resolveUseCodexAppServer for precedence.
    const useAppServer = !!nativeBinary && resolveUseCodexAppServer(config);
    logger.info(
      `Codex sub-adapter selected: ${useAppServer ? "app-server (native codex)" : "codex-acp"}`,
      {
        useAppServer,
        nativeBinaryFound: !!nativeBinary,
        hostFlag: config.useCodexAppServer,
      },
    );
    if (useAppServer) {
      agent = new CodexAppServerAgent(client, {
        processOptions: {
          binaryPath: nativeBinary,
          cwd: codexOptions.cwd,
          apiBaseUrl: codexOptions.apiBaseUrl,
          apiKey: codexOptions.apiKey,
          codexHome: codexOptions.codexHome,
          developerInstructions: codexOptions.developerInstructions,
          configOverrides: codexOptions.configOverrides,
        },
        model: codexOptions.model,
        reasoningEffort: codexOptions.reasoningEffort,
        processCallbacks: config.processCallbacks,
        onStructuredOutput: config.onStructuredOutput,
        logger: config.logger?.child("CodexAppServerAgent"),
      });
      return agent;
    }

    agent = new CodexAcpAgent(client, {
      codexProcessOptions: { ...codexOptions, environment: config.deviceType },
      processCallbacks: config.processCallbacks,
      posthogApiConfig: resolveEnricherApiConfig(config),
      onStructuredOutput: config.onStructuredOutput,
      logger: config.logger?.child("CodexAcpAgent"),
    });
    return agent;
  }, agentStream);

  return {
    agentConnection,
    clientStreams: {
      readable: streams.client.readable,
      writable: clientWritable,
    },
    cleanup: async () => {
      logger.info("Cleaning up Codex connection");

      if (agent) {
        await agent.closeSession();
      }

      try {
        await streams.client.writable.close();
      } catch {
        // Stream may already be closed
      }
      try {
        await streams.agent.writable.close();
      } catch {
        // Stream may already be closed
      }
    },
  };
}
