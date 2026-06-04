import { tmpdir } from "node:os";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import {
  applySpecStreamPatch,
  createMixedStreamParser,
  type MixedStreamParser,
} from "@json-render/core";
import type { AcpMessage } from "@shared/types/session-events";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import {
  AgentServiceEvent,
  type AgentSessionEventPayload,
} from "../agent/schemas";
import type { AgentService } from "../agent/service";
import type { AuthService } from "../auth/service";
import {
  CanvasGenEvent,
  type CanvasGenEvents,
  type CanvasGenerateInput,
  type CanvasStreamEvent,
  type CanvasThreadInput,
} from "./schemas";

const log = logger.scope("canvas-gen");

const TASK_RUN_PREFIX = "canvas:";

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

  constructor(
    @inject(MAIN_TOKENS.AgentService)
    private readonly agentService: AgentService,
    @inject(MAIN_TOKENS.AuthService)
    private readonly authService: AuthService,
  ) {
    super();
  }

  async generate(input: CanvasGenerateInput): Promise<void> {
    const { threadId, prompt, systemPrompt, model } = input;
    const taskRunId = `${TASK_RUN_PREFIX}${threadId}`;

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

    this.emitEvent(threadId, { type: "started" });

    const promptBlocks: ContentBlock[] = [{ type: "text", text: prompt }];
    try {
      await this.agentService.prompt(taskRunId, promptBlocks);
      this.threads.get(threadId)?.parser.flush();
      this.emitEvent(threadId, { type: "done" });
    } catch (err) {
      log.warn("Canvas prompt failed", { threadId, err });
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
      ...(model ? { model } : {}),
    });

    this.threads.set(threadId, this.createThreadState(threadId));
    this.startedSessions.add(threadId);
  }

  private createThreadState(threadId: string): ThreadState {
    const state: ThreadState = {
      spec: {},
      parser: createMixedStreamParser({
        onText: (text) => {
          if (text.trim().length === 0) return;
          this.emitEvent(threadId, { type: "prose", text });
        },
        onPatch: (patch) => {
          state.spec = applySpecStreamPatch(state.spec, patch);
          if (typeof state.spec.root === "string" && state.spec.root) {
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
        log.warn("Failed to handle canvas ACP frame", { threadId, err });
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
