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
import { CodexAcpAgent } from "./codex/codex-agent";
import type { CodexProcessOptions } from "./codex/spawn";

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
  /** Callback invoked when the agent calls the create_output tool for structured output */
  onStructuredOutput?: (output: Record<string, unknown>) => Promise<void>;
  /** PostHog API config; when set, enables file-read enrichment unless disabled. */
  posthogApiConfig?: PostHogAPIConfig;
  /** Defaults to true when posthogApiConfig is set. Set to false to disable enrichment. */
  enricherEnabled?: boolean;
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

  let agent: CodexAcpAgent | null = null;
  const agentConnection = new AgentSideConnection((client) => {
    agent = new CodexAcpAgent(client, {
      codexProcessOptions: config.codexOptions ?? {},
      processCallbacks: config.processCallbacks,
      posthogApiConfig: resolveEnricherApiConfig(config),
      onStructuredOutput: config.onStructuredOutput,
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
