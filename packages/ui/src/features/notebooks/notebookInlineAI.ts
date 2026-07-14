import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import type { MarkdownNotebookAskAIRequest } from "./markdown-notebook/MarkdownNotebook";
import {
  insertNotebookAIFollowUpPromptAfterResponse,
  rebaseNotebookAIResponseRange,
  replaceNotebookAIResponseMarkdown,
  streamNotebookAIResponseMarkdown,
} from "./markdown-notebook/notebookAI";

/** Follow-up prompt block appended after a completed AI response, mirroring
 * the PostHog webapp's NOTEBOOK_AI_FOLLOW_UP_PROMPT_MARKDOWN. */
export const NOTEBOOK_AI_FOLLOW_UP_PROMPT_MARKDOWN = '<Prompt question="" />';

const AI_ERROR_PREFIX = "Something went wrong asking AI:";

export interface NotebookInlineAIDeps {
  getClient: () => PostHogAPIClient | null;
  getNotebookMeta: () => { shortId: string; title: string };
  getMarkdown: () => string;
  /** Woven content reaches both the editor and the autosave engine here. */
  setMarkdown: (markdown: string) => void;
  /** Union of node indexes AI is currently writing into (for read-only styling). */
  setWritingNodeIndexes: (indexes: number[]) => void;
  /** Focus the follow-up prompt inserted after a completed response. */
  requestPromptFocus: () => void;
}

type InlineAIRun = {
  /** Index of the LAST node of the response range (matches the vendored helpers). */
  responseNodeIndex: number;
  responseNodeCount: number;
  /** Latest full accumulated assistant markdown (the stream re-sends it whole). */
  latestContent: string;
  abortController: AbortController;
};

/**
 * Framework-free runner connecting the markdown notebook's "Ask AI" prompt to
 * PostHog's Max conversations API, in the style of NotebookSyncEngine.
 *
 * Each `handleAskAI` starts one run: it POSTs the turn to
 * `/api/environments/{team}/conversations/` and consumes the SSE response.
 * Assistant messages re-send the full accumulated markdown each tick, which is
 * woven over the "Thinking..." placeholder range via the vendored
 * `streamNotebookAIResponseMarkdown`; on completion the final content is
 * committed with `replaceNotebookAIResponseMarkdown` and a follow-up prompt
 * block is inserted after it. User edits that land mid-stream are remapped
 * through `handleDocumentChange` (fingerprint-based rebase) before the AI
 * writes again.
 */
export class NotebookInlineAIController {
  private readonly runs = new Map<string, InlineAIRun>();
  private disposed = false;
  /** Last markdown this controller wrote, so our own writes echoed back
   * through the editor's onChange are not rebased as user edits. */
  private lastWrittenMarkdown: string | null = null;

  constructor(private readonly deps: NotebookInlineAIDeps) {}

  /** The editor submitted a prompt; its placeholder paragraph is already in the document. */
  handleAskAI(request: MarkdownNotebookAskAIRequest): void {
    if (this.disposed) return;
    const run: InlineAIRun = {
      responseNodeIndex: request.responseNodeIndex,
      responseNodeCount: 1,
      latestContent: "",
      abortController: new AbortController(),
    };
    this.runs.set(request.conversationId, run);
    this.updateWritingIndexes();
    void this.streamRun(request, run);
  }

  /**
   * The document changed for a reason other than this controller writing
   * (user typing, remote merge). Remap every active run's response range
   * through the edit so the next AI tick writes to the right nodes.
   */
  handleDocumentChange(previousMarkdown: string, nextMarkdown: string): void {
    if (this.disposed || !this.runs.size) return;
    if (previousMarkdown === nextMarkdown) return;
    if (nextMarkdown === this.lastWrittenMarkdown) return;
    for (const run of this.runs.values()) {
      const rebased = rebaseNotebookAIResponseRange(
        previousMarkdown,
        nextMarkdown,
        run.responseNodeIndex,
        run.responseNodeCount,
      );
      run.responseNodeIndex = rebased.responseNodeIndex;
      run.responseNodeCount = rebased.responseNodeCount;
    }
    this.updateWritingIndexes();
  }

  /** Abort all in-flight runs (best-effort backend cancel included). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const client = this.deps.getClient();
    for (const [conversationId, run] of this.runs) {
      run.abortController.abort();
      if (client) {
        void client.cancelConversation(conversationId).catch(() => {
          // Best-effort: aborting the stream fetch is the load-bearing part.
        });
      }
    }
    this.runs.clear();
    this.deps.setWritingNodeIndexes([]);
  }

  private async streamRun(
    request: MarkdownNotebookAskAIRequest,
    run: InlineAIRun,
  ): Promise<void> {
    const conversationId = request.conversationId;
    try {
      const client = this.deps.getClient();
      if (!client) {
        throw new Error("not connected to PostHog");
      }
      const meta = this.deps.getNotebookMeta();
      const response = await client.startConversationStream(
        {
          content: request.query,
          conversation: conversationId,
          contextual_tools: {},
          ui_context: {
            notebooks: [
              {
                type: "notebook",
                id: meta.shortId,
                name: meta.title,
                markdown_with_insertion_placeholder:
                  request.markdownWithResponse,
                insertion_placeholder_block_id: conversationId,
                insertion_placeholder_marker: request.responseMarker,
              },
            ],
          },
          trace_id: globalThis.crypto.randomUUID(),
        },
        run.abortController.signal,
      );
      if (!response.body) {
        throw new Error("the response had no body");
      }
      await this.readSSEStream(response.body, (eventName, data) =>
        this.handleServerEvent(run, eventName, data),
      );
      this.finishRun(conversationId, run);
    } catch (error) {
      this.failRun(
        conversationId,
        run,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Stream ended cleanly: commit the final content and offer a follow-up prompt. */
  private finishRun(conversationId: string, run: InlineAIRun): void {
    if (!this.runs.delete(conversationId)) return;
    if (!run.latestContent.trim()) {
      this.weaveError(run, "the response was empty");
      this.updateWritingIndexes();
      return;
    }
    const replaced = replaceNotebookAIResponseMarkdown(
      this.deps.getMarkdown(),
      run.responseNodeIndex,
      run.latestContent,
      run.responseNodeCount,
    );
    const withFollowUpPrompt = insertNotebookAIFollowUpPromptAfterResponse(
      replaced.markdown,
      replaced.responseNodeIndex,
      NOTEBOOK_AI_FOLLOW_UP_PROMPT_MARKDOWN,
    );
    this.setMarkdown(withFollowUpPrompt);
    this.updateWritingIndexes();
    this.deps.requestPromptFocus();
  }

  private failRun(
    conversationId: string,
    run: InlineAIRun,
    message: string,
  ): void {
    // Already finished, or removed by dispose() (whose abort lands here as an
    // AbortError) — nothing to weave.
    if (!this.runs.delete(conversationId)) return;
    run.abortController.abort();
    this.weaveError(run, message);
    this.updateWritingIndexes();
  }

  private weaveError(run: InlineAIRun, message: string): void {
    const result = replaceNotebookAIResponseMarkdown(
      this.deps.getMarkdown(),
      run.responseNodeIndex,
      `${AI_ERROR_PREFIX} ${message}`,
      run.responseNodeCount,
    );
    this.setMarkdown(result.markdown);
  }

  private handleServerEvent(
    run: InlineAIRun,
    eventName: string,
    data: string,
  ): void {
    // `conversation`, `status` and `update` events carry no notebook content.
    if (eventName !== "message") return;
    let message: { type?: unknown; content?: unknown };
    try {
      message = JSON.parse(data) as { type?: unknown; content?: unknown };
    } catch {
      return;
    }
    if (message.type === "ai" && typeof message.content === "string") {
      this.applyAssistantContent(run, message.content);
      return;
    }
    if (message.type === "ai/failure") {
      // Propagates out of the read loop into streamRun's catch → failRun.
      throw new Error(
        typeof message.content === "string" && message.content
          ? message.content
          : "Max has failed to generate an answer",
      );
    }
    // `human` echo, tool calls, reasoning, viz/artifact/notebook messages:
    // nothing to weave for this port.
  }

  private applyAssistantContent(run: InlineAIRun, content: string): void {
    run.latestContent = content;
    const result = streamNotebookAIResponseMarkdown(
      this.deps.getMarkdown(),
      run.responseNodeIndex,
      content,
      run.responseNodeCount,
    );
    run.responseNodeIndex = result.responseNodeIndex;
    run.responseNodeCount = result.responseNodeCount;
    this.setMarkdown(result.markdown);
    this.updateWritingIndexes();
  }

  private setMarkdown(markdown: string): void {
    this.lastWrittenMarkdown = markdown;
    this.deps.setMarkdown(markdown);
  }

  private updateWritingIndexes(): void {
    const indexes = new Set<number>();
    for (const run of this.runs.values()) {
      const start = Math.max(
        0,
        run.responseNodeIndex - run.responseNodeCount + 1,
      );
      for (let index = start; index <= run.responseNodeIndex; index++) {
        indexes.add(index);
      }
    }
    this.deps.setWritingNodeIndexes([...indexes].sort((a, b) => a - b));
  }

  /**
   * Minimal SSE parser: utf-8 decode, accumulate `event:`/`data:` field lines
   * (data may span multiple lines, joined with "\n"), dispatch on a blank
   * line, ignore `:` comment lines.
   */
  private async readSSEStream(
    body: ReadableStream<Uint8Array>,
    onEvent: (eventName: string, data: string) => void,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "";
    let dataLines: string[] = [];

    const dispatch = () => {
      if (dataLines.length) {
        onEvent(eventName || "message", dataLines.join("\n"));
      }
      eventName = "";
      dataLines = [];
    };

    const handleLine = (rawLine: string) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line) {
        dispatch();
        return;
      }
      if (line.startsWith(":")) return;
      const colonIndex = line.indexOf(":");
      const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
      let value = colonIndex === -1 ? "" : line.slice(colonIndex + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") {
        eventName = value;
      } else if (field === "data") {
        dataLines.push(value);
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          handleLine(buffer.slice(0, newlineIndex));
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf("\n");
        }
      }
      buffer += decoder.decode();
      if (buffer) handleLine(buffer);
      dispatch();
    } finally {
      reader.releaseLock();
    }
  }
}
