import { tmpdir } from "node:os";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import {
  applySpecStreamPatch,
  createMixedStreamParser,
  type MixedStreamParser,
} from "@json-render/core";
import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import {
  CanvasGenEvent,
  type CanvasGenEvents,
  type CanvasGenerateInput,
  type CanvasStreamEvent,
  type CanvasThreadInput,
} from "@posthog/core/canvas/genSchemas";
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

const TASK_RUN_PREFIX = "canvas:";

// File-writing, shell, and network tools the canvas agent must never use. It
// builds dashboards from PostHog MCP data only; everything else is denied so the
// turn can't write files, run commands, or fetch arbitrary URLs.
const CANVAS_DISALLOWED_TOOLS = [
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
];

interface ThreadState {
  /** The json-render Spec assembled from streamed JSONL patches. */
  spec: Record<string, unknown>;
  /** Splits the agent's mixed prose + JSONL stream into text and patches. */
  parser: MixedStreamParser;
}

/**
 * Drives an ephemeral PostHog agent turn for the canvas generation surface.
 *
 * Reuses {@link AgentService} (which auto-enables the PostHog MCP server) to run
 * a `__preview__` session per thread with a json-render system prompt, then
 * forwards the agent's ACP session updates — splitting prose from json-render
 * JSONL patches and assembling the Spec — as typed events for the renderer.
 */
@injectable()
export class CanvasGenService extends TypedEventEmitter<CanvasGenEvents> {
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
    this.log = rootLogger.scope("canvas-gen");
  }

  async generate(input: CanvasGenerateInput): Promise<void> {
    const { threadId, prompt, templateId, model, currentSpec } = input;
    const taskRunId = `${TASK_RUN_PREFIX}${threadId}`;
    const systemPrompt = this.templatesService.systemPromptFor(templateId);

    this.ensureForwarding();

    try {
      await this.ensureSession(
        threadId,
        taskRunId,
        systemPrompt,
        model,
        currentSpec,
      );
    } catch (err) {
      this.emitEvent(threadId, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Re-seed the working spec from what the renderer currently shows, EVERY
    // turn. Main keeps its own accumulator separate from the renderer; after a
    // renderer reload (main process survives) or for a session started before
    // the board hydrated, that accumulator is empty/stale. Without this, an edit
    // patch like `add /elements/table` lands in a spec with no `root`, and the
    // emit gate (root must exist) silently drops every update — the agent's
    // changes never reach the canvas. The renderer's spec is the source of truth.
    if (currentSpec) {
      const thread = this.threads.get(threadId);
      if (thread) thread.spec = { ...currentSpec };
    }

    this.emitEvent(threadId, { type: "started" });

    const promptBlocks: ContentBlock[] = [{ type: "text", text: prompt }];
    try {
      await this.agentService.prompt(taskRunId, promptBlocks);
      this.threads.get(threadId)?.parser.flush();
      this.emitEvent(threadId, { type: "done" });
    } catch (err) {
      this.log.warn("Canvas prompt failed", { threadId, err });
      this.emitEvent(threadId, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async reset(input: CanvasThreadInput): Promise<void> {
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
    currentSpec?: Record<string, unknown> | null,
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
      // The canvas agent only needs PostHog MCP (read) tools. Deny file/shell/
      // network tools so a misbehaving or prompt-injected turn can't write
      // files, run commands, or exfiltrate — a hard guard, not just the prompt.
      disallowedTools: CANVAS_DISALLOWED_TOOLS,
      ...(model ? { model } : {}),
    });

    this.threads.set(threadId, this.createThreadState(threadId, currentSpec));
    this.startedSessions.add(threadId);
  }

  private createThreadState(
    threadId: string,
    initialSpec?: Record<string, unknown> | null,
  ): ThreadState {
    const state: ThreadState = {
      // Seed with the saved spec so the agent appends onto the existing board
      // instead of rebuilding from empty (which would wipe a reopened canvas).
      spec: initialSpec ? { ...initialSpec } : {},
      parser: createMixedStreamParser({
        onText: (text) => {
          if (text.trim().length === 0) return;
          this.emitEvent(threadId, { type: "prose", text });
        },
        onPatch: (patch) => {
          state.spec = applySpecStreamPatch(state.spec, patch);
          // Only emit once the spec is renderable: the root must exist AND its
          // element must be present. Emitting earlier ships partial/invalid
          // snapshots that can crash the renderer mid-stream.
          const root = state.spec.root;
          const elements = state.spec.elements as
            | Record<string, unknown>
            | undefined;
          if (typeof root === "string" && root && elements?.[root]) {
            this.emitEvent(threadId, { type: "spec", spec: { ...state.spec } });
          }
        },
      }),
    };
    return state;
  }

  /** Lazily start the single loop forwarding agent session updates for all
   * canvas threads. The service is a singleton, so this runs for app lifetime. */
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
        this.log.warn("Failed to handle canvas ACP frame", { threadId, err });
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

  private emitEvent(threadId: string, event: CanvasStreamEvent): void {
    this.emit(CanvasGenEvent.Event, { threadId, event });
  }
}
