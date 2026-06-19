import { tmpdir } from "node:os";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import {
  FREEFORM_TEMPLATE_ID,
  FreeformGenEvent,
  type FreeformGenEvents,
  type FreeformGenerateInput,
  type FreeformStreamEvent,
  type FreeformThreadInput,
} from "@posthog/core/canvas/freeformSchemas";
import {
  createFreeformStreamParser,
  type FreeformStreamParser,
} from "@posthog/core/canvas/freeformStreamParser";
import { CANVAS_TEMPLATES_SERVICE } from "@posthog/core/canvas/identifiers";
import type { ICanvasTemplatesService } from "@posthog/core/canvas/services";
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

const TASK_RUN_PREFIX = "freeform:";

// Same hard tool denial as the json-render canvas agent: it writes its app as
// text in its reply, never to disk, and reads PostHog only via MCP. Everything
// that could write files, run commands, or fetch arbitrary URLs is denied so a
// prompt-injected turn can't escape the sandbox at authoring time.
const FREEFORM_DISALLOWED_TOOLS = [
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
];

interface ThreadState {
  parser: FreeformStreamParser;
}

/**
 * Drives an ephemeral PostHog agent turn for the FREEFORM (React-in-iframe)
 * canvas surface. Mirrors {@link CanvasGenService} but the agent writes a single
 * React file rather than json-render patches, so we split its reply into prose +
 * code snapshots ({@link createFreeformStreamParser}) and forward those.
 */
@injectable()
export class FreeformGenService extends TypedEventEmitter<FreeformGenEvents> {
  private readonly threads = new Map<string, ThreadState>();
  private readonly startedSessions = new Set<string>();
  private forwarding = false;

  private readonly log: ScopedLogger;

  constructor(
    @inject(AGENT_SERVICE)
    private readonly agentService: AgentService,
    @inject(AUTH_SERVICE)
    private readonly authService: AuthService,
    @inject(CANVAS_TEMPLATES_SERVICE)
    private readonly templatesService: ICanvasTemplatesService,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    super();
    this.log = rootLogger.scope("freeform-gen");
  }

  async generate(input: FreeformGenerateInput): Promise<void> {
    const { threadId, prompt, model } = input;
    const taskRunId = `${TASK_RUN_PREFIX}${threadId}`;
    const systemPrompt =
      this.templatesService.systemPromptFor(FREEFORM_TEMPLATE_ID);

    this.ensureForwarding();

    try {
      await this.ensureSession(threadId, taskRunId, systemPrompt, model);
    } catch (err) {
      this.emitEvent(threadId, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Fresh parser each turn: full-file rewrite means each turn is one complete
    // file, so prose/code accounting must restart (no carryover from last turn).
    const thread = this.threads.get(threadId);
    if (thread) thread.parser = this.createParser(threadId);

    this.emitEvent(threadId, { type: "started" });

    const promptBlocks: ContentBlock[] = [{ type: "text", text: prompt }];
    try {
      await this.agentService.prompt(taskRunId, promptBlocks);
      this.threads.get(threadId)?.parser.flush();
      this.emitEvent(threadId, { type: "done" });
    } catch (err) {
      this.log.warn("Freeform prompt failed", { threadId, err });
      this.emitEvent(threadId, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async reset(input: FreeformThreadInput): Promise<void> {
    const { threadId } = input;
    const taskRunId = `${TASK_RUN_PREFIX}${threadId}`;
    this.startedSessions.delete(threadId);
    this.threads.delete(threadId);
    await this.agentService.cancelSession(taskRunId).catch(() => {});
  }

  private async ensureSession(
    threadId: string,
    taskRunId: string,
    systemPrompt: string,
    model?: string,
  ): Promise<void> {
    if (this.startedSessions.has(threadId)) return;

    const { apiHost } = await this.authService.getValidAccessToken();
    const projectId = this.authService.getState().currentProjectId;
    if (projectId == null) {
      throw new Error("No PostHog project selected");
    }

    await this.agentService.startSession({
      taskId: "__preview__",
      taskRunId,
      repoPath: tmpdir(),
      apiHost,
      projectId,
      permissionMode: "bypassPermissions",
      systemPromptOverride: systemPrompt,
      disallowedTools: FREEFORM_DISALLOWED_TOOLS,
      ...(model ? { model } : {}),
    });

    this.threads.set(threadId, { parser: this.createParser(threadId) });
    this.startedSessions.add(threadId);
  }

  private createParser(threadId: string): FreeformStreamParser {
    return createFreeformStreamParser({
      onProse: (text) => this.emitEvent(threadId, { type: "prose", text }),
      onCode: (code) => this.emitEvent(threadId, { type: "code", code }),
    });
  }

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
      const threadId = event.taskRunId.slice(TASK_RUN_PREFIX.length);
      try {
        this.handleAcp(threadId, event.payload);
      } catch (err) {
        this.log.warn("Failed to handle freeform ACP frame", { threadId, err });
      }
    }
  }

  private handleAcp(threadId: string, payload: unknown): void {
    const state = this.threads.get(threadId);
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
        if (content?.text) state.parser.push(content.text);
        break;
      }
      case "tool_call":
      case "tool_call_update": {
        const toolName =
          (update.title as string | undefined) ??
          (update.toolCallId as string | undefined) ??
          "tool";
        const status = (update.status as string | undefined) ?? "pending";
        this.emitEvent(threadId, { type: "tool", toolName, status });
        break;
      }
      default:
        break;
    }
  }

  private emitEvent(threadId: string, event: FreeformStreamEvent): void {
    this.emit(FreeformGenEvent.Event, { threadId, event });
  }
}
