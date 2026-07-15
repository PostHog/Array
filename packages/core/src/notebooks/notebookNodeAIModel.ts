import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { injectable } from "inversify";

// Transport seam for the notebook node AI editor. The service depends on this
// interface so tests can fake the model; the default implementation prefers
// the direct LLM-gateway completion (single non-agentic round trip) and falls
// back to a Max conversation turn when the gateway is unreachable for this
// login (e.g. self-hosted without a gateway, or a token the gateway rejects).

export interface NotebookNodeAIModelRequest {
  system: string;
  user: string;
  signal?: AbortSignal;
  /** Called with the full accumulated text on every streamed delta. */
  onText?: (accumulatedText: string) => void;
}

export interface NotebookNodeAIModel {
  /** One-shot completion. Resolves with the full response text. */
  complete(
    client: PostHogAPIClient,
    request: NotebookNodeAIModelRequest,
  ): Promise<string>;
}

export const NOTEBOOK_NODE_AI_MODEL = Symbol.for(
  "posthog.notebooks.nodeAIModel",
);

/** Fast + cheap; the same model the harness uses for one-shot summarization. */
const GATEWAY_MODEL = "claude-haiku-4-5";

/**
 * Minimal SSE parser shared by both transports: utf-8 decode, accumulate
 * `event:`/`data:` field lines (multi-line data joined with "\n"), dispatch on
 * a blank line, ignore `:` comments. Mirrors the parser proven against the
 * conversations endpoint in the notebooks inline-AI controller.
 */
export async function readNotebookAISSEStream(
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

@injectable()
export class PostHogNotebookNodeAIModel implements NotebookNodeAIModel {
  /** Sticky: once the gateway rejects this login, stop paying its round trip. */
  private gatewayUnavailable = false;

  async complete(
    client: PostHogAPIClient,
    request: NotebookNodeAIModelRequest,
  ): Promise<string> {
    if (!this.gatewayUnavailable) {
      try {
        return await this.completeViaGateway(client, request);
      } catch (error) {
        if (request.signal?.aborted) throw error;
        this.gatewayUnavailable = true;
      }
    }
    return await this.completeViaMaxConversation(client, request);
  }

  private async completeViaGateway(
    client: PostHogAPIClient,
    request: NotebookNodeAIModelRequest,
  ): Promise<string> {
    const response = await client.llmGatewayChatCompletion(
      {
        model: GATEWAY_MODEL,
        stream: true,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      },
      request.signal,
    );
    if (!response.body) {
      throw new Error("LLM gateway response had no body");
    }
    let text = "";
    await readNotebookAISSEStream(response.body, (_eventName, data) => {
      if (data === "[DONE]") return;
      let chunk: {
        choices?: { delta?: { content?: unknown } }[];
        error?: { message?: unknown };
      };
      try {
        chunk = JSON.parse(data) as typeof chunk;
      } catch {
        return;
      }
      if (chunk.error) {
        throw new Error(
          typeof chunk.error.message === "string"
            ? chunk.error.message
            : "LLM gateway stream error",
        );
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        text += delta;
        request.onText?.(text);
      }
    });
    if (!text.trim()) {
      throw new Error("LLM gateway returned an empty response");
    }
    return text;
  }

  /**
   * Fallback: one Max conversation turn. Max is a server-side agent graph, so
   * this is slower and chattier than the gateway, but it works with any
   * PostHog login. Assistant messages re-send the full accumulated content
   * each tick (same contract the notebook inline AI streams against).
   */
  private async completeViaMaxConversation(
    client: PostHogAPIClient,
    request: NotebookNodeAIModelRequest,
  ): Promise<string> {
    const abort = new AbortController();
    const onOuterAbort = () => abort.abort();
    request.signal?.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const response = await client.startConversationStream(
        {
          content: `${request.system}\n\n${request.user}`,
          conversation: globalThis.crypto.randomUUID(),
          contextual_tools: {},
          ui_context: {},
          trace_id: globalThis.crypto.randomUUID(),
        },
        abort.signal,
      );
      if (!response.body) {
        throw new Error("Max conversation response had no body");
      }
      let text = "";
      await readNotebookAISSEStream(response.body, (eventName, data) => {
        if (eventName !== "message") return;
        let message: { type?: unknown; content?: unknown };
        try {
          message = JSON.parse(data) as typeof message;
        } catch {
          return;
        }
        if (message.type === "ai" && typeof message.content === "string") {
          text = message.content;
          request.onText?.(text);
        } else if (message.type === "ai/failure") {
          throw new Error(
            typeof message.content === "string" && message.content
              ? message.content
              : "Max failed to generate an answer",
          );
        }
      });
      if (!text.trim()) {
        throw new Error("Max returned an empty response");
      }
      return text;
    } finally {
      request.signal?.removeEventListener("abort", onOuterAbort);
    }
  }
}
