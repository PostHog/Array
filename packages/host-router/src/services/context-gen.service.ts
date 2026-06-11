import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import {
  ContextGenEvent,
  type ContextGenEvents,
  type ContextGenerateInput,
  type ContextStreamEvent,
  type ContextThreadInput,
} from "@posthog/core/canvas/contextGenSchemas";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { type AcpMessage, TypedEventEmitter } from "@posthog/shared";
import type { AgentService } from "@posthog/workspace-server/services/agent/agent";
import { AGENT_SERVICE } from "@posthog/workspace-server/services/agent/identifiers";
import {
  AgentServiceEvent,
  type AgentSessionEventPayload,
} from "@posthog/workspace-server/services/agent/schemas";
import { inject, injectable } from "inversify";

const TASK_RUN_PREFIX = "context:";

// Local file-mutation, shell, and network tools the context agent must never
// use. It explores the repo read-only (Read/Grep/Glob) and reads PostHog data
// via the MCP, then publishes CONTEXT.md through the PostHog MCP
// (`desktop-file-system-instructions-partial-update`). MCP tools are NOT denied
// — the agent needs them to read data and to publish the result.
const CONTEXT_DISALLOWED_TOOLS = [
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
];

interface ChannelState {
  /** Accumulated markdown the agent has streamed so far (live preview). */
  buffer: string;
}

/**
 * Drives an ephemeral PostHog agent turn that generates a channel's CONTEXT.md.
 *
 * Reuses {@link AgentService} (which auto-enables the PostHog MCP server) to run
 * a `__preview__` session per channel — rooted at the channel's local repo so
 * the agent can explore code — then forwards the agent's ACP session updates
 * (streamed prose + tool-call activity) as typed events for the renderer. The
 * agent publishes the final document itself via the PostHog MCP; this service
 * does not capture or persist the result.
 */
@injectable()
export class ContextGenService extends TypedEventEmitter<ContextGenEvents> {
  private readonly channels = new Map<string, ChannelState>();
  private readonly startedSessions = new Set<string>();
  private forwarding = false;

  private readonly log: ScopedLogger;

  constructor(
    @inject(AGENT_SERVICE)
    private readonly agentService: AgentService,
    @inject(AUTH_SERVICE)
    private readonly authService: AuthService,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    super();
    this.log = rootLogger.scope("context-gen");
  }

  async generate(input: ContextGenerateInput): Promise<void> {
    const { channelId, repoPath, systemPrompt, model } = input;
    const taskRunId = `${TASK_RUN_PREFIX}${channelId}`;

    this.ensureForwarding();

    try {
      await this.ensureSession(
        channelId,
        taskRunId,
        repoPath,
        systemPrompt,
        model,
      );
    } catch (err) {
      this.emitEvent(channelId, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    this.emitEvent(channelId, { type: "started" });

    const promptBlocks: ContentBlock[] = [
      { type: "text", text: "Generate the CONTEXT.md now." },
    ];
    try {
      await this.agentService.prompt(taskRunId, promptBlocks);
      this.emitEvent(channelId, { type: "done" });
    } catch (err) {
      this.log.warn("Context prompt failed", { channelId, err });
      this.emitEvent(channelId, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async reset(input: ContextThreadInput): Promise<void> {
    const { channelId } = input;
    const taskRunId = `${TASK_RUN_PREFIX}${channelId}`;
    this.startedSessions.delete(channelId);
    this.channels.delete(channelId);
    await this.agentService.cancelSession(taskRunId).catch(() => {});
  }

  private async ensureSession(
    channelId: string,
    taskRunId: string,
    repoPath: string,
    systemPrompt: string,
    model?: string,
  ): Promise<void> {
    if (this.startedSessions.has(channelId)) return;

    const { apiHost } = await this.authService.getValidAccessToken();
    const projectId = this.authService.getState().currentProjectId;
    if (projectId == null) {
      throw new Error("No PostHog project selected");
    }

    await this.agentService.startSession({
      taskId: "__preview__",
      taskRunId,
      repoPath,
      apiHost,
      projectId,
      permissionMode: "bypassPermissions",
      systemPromptOverride: systemPrompt,
      // Read-only code exploration + PostHog MCP only. Deny local file writes,
      // shell, and network so a misbehaving or prompt-injected turn can't
      // mutate the repo, run commands, or exfiltrate — a hard guard, not just
      // the prompt. (MCP tools stay enabled so the agent can publish.)
      disallowedTools: CONTEXT_DISALLOWED_TOOLS,
      ...(model ? { model } : {}),
    });

    this.channels.set(channelId, { buffer: "" });
    this.startedSessions.add(channelId);
  }

  /** Lazily start the single loop forwarding agent session updates for all
   * context-gen channels. The service is a singleton, so this runs for app
   * lifetime. */
  private ensureForwarding(): void {
    if (this.forwarding) return;
    this.forwarding = true;
    void this.forwardLoop();
  }

  private async forwardLoop(): Promise<void> {
    const iterable = this.agentService.toIterable(
      AgentServiceEvent.SessionEvent,
    );
    for await (const event of iterable as AsyncIterable<AgentSessionEventPayload>) {
      if (!event.taskRunId.startsWith(TASK_RUN_PREFIX)) continue;
      const channelId = event.taskRunId.slice(TASK_RUN_PREFIX.length);
      try {
        this.handleAcp(channelId, event.payload);
      } catch (err) {
        this.log.warn("Failed to handle context ACP frame", { channelId, err });
      }
    }
  }

  private handleAcp(channelId: string, payload: unknown): void {
    const state = this.channels.get(channelId);
    if (!state) return;

    const message = (payload as AcpMessage | undefined)?.message as
      | { method?: string; params?: { update?: Record<string, unknown> } }
      | undefined;
    if (!message || message.method !== "session/update") return;

    const update = message.params?.update;
    if (!update) return;

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const content = update.content as { text?: string } | undefined;
        if (content?.text) {
          state.buffer += content.text;
          this.emitEvent(channelId, { type: "prose", text: content.text });
        }
        break;
      }
      case "tool_call":
      case "tool_call_update": {
        const toolName =
          (update.title as string | undefined) ??
          (update.toolCallId as string | undefined) ??
          "tool";
        const status = (update.status as string | undefined) ?? "pending";
        this.emitEvent(channelId, { type: "tool", toolName, status });
        break;
      }
      default:
        break;
    }
  }

  private emitEvent(channelId: string, event: ContextStreamEvent): void {
    this.emit(ContextGenEvent.Event, { channelId, event });
  }
}
