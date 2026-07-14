import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { describe, expect, it, vi } from "vitest";
import type { MarkdownNotebookAskAIRequest } from "./markdown-notebook/MarkdownNotebook";
import { NOTEBOOK_AI_WRITING_PLACEHOLDER } from "./markdown-notebook/notebookAI";
import {
  NOTEBOOK_AI_FOLLOW_UP_PROMPT_MARKDOWN,
  NotebookInlineAIController,
} from "./notebookInlineAI";

// Realistic starting document: the editor has already swapped the submitted
// <Prompt> block for the "Thinking..." placeholder paragraph at node index 1.
const INITIAL_MARKDOWN = `# Title\n\n${NOTEBOOK_AI_WRITING_PLACEHOLDER}`;

function makeRequest(
  overrides?: Partial<MarkdownNotebookAskAIRequest>,
): MarkdownNotebookAskAIRequest {
  return {
    conversationId: "conv-1",
    query: "guardrail-wrapped question",
    source: "slash",
    responseNodeId: "node-1",
    responseNodeIndex: 1,
    responseMarker: NOTEBOOK_AI_WRITING_PLACEHOLDER,
    markdown: '# Title\n\n<Prompt question="hello" />',
    markdownWithResponse: INITIAL_MARKDOWN,
    ...overrides,
  };
}

function createSSEServer() {
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    emitRaw: (chunk: string) => streamController.enqueue(encoder.encode(chunk)),
    emit: (eventName: string, data: unknown) =>
      streamController.enqueue(
        encoder.encode(
          `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`,
        ),
      ),
    close: () => streamController.close(),
  };
}

function createHarness(options?: {
  initialMarkdown?: string;
  startConversationStream?: (
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<Response>;
}) {
  const sse = createSSEServer();
  const calls: { body: Record<string, unknown>; signal: AbortSignal }[] = [];
  const cancelledConversations: string[] = [];
  let markdown = options?.initialMarkdown ?? INITIAL_MARKDOWN;
  const writingIndexUpdates: number[][] = [];
  let promptFocusRequests = 0;

  const client = {
    startConversationStream: async (
      body: Record<string, unknown>,
      signal: AbortSignal,
    ): Promise<Response> => {
      calls.push({ body, signal });
      if (options?.startConversationStream) {
        return options.startConversationStream(body, signal);
      }
      return sse.response;
    },
    cancelConversation: async (conversationId: string): Promise<void> => {
      cancelledConversations.push(conversationId);
    },
  } as unknown as PostHogAPIClient;

  const controller = new NotebookInlineAIController({
    getClient: () => client,
    getNotebookMeta: () => ({ shortId: "nb-short", title: "My notebook" }),
    getMarkdown: () => markdown,
    setMarkdown: (next) => {
      markdown = next;
    },
    setWritingNodeIndexes: (indexes) => {
      writingIndexUpdates.push(indexes);
    },
    requestPromptFocus: () => {
      promptFocusRequests++;
    },
  });

  return {
    sse,
    calls,
    cancelledConversations,
    controller,
    markdown: () => markdown,
    /** Simulate an edit made in the editor (user typing), not by the AI. */
    applyUserEdit: (next: string) => {
      const previous = markdown;
      markdown = next;
      controller.handleDocumentChange(previous, next);
    },
    writingIndexUpdates,
    lastWritingIndexes: () =>
      writingIndexUpdates[writingIndexUpdates.length - 1],
    promptFocusRequests: () => promptFocusRequests,
  };
}

describe("NotebookInlineAIController", () => {
  it("streams assistant content over the placeholder and finishes with a follow-up prompt", async () => {
    const h = createHarness();
    h.controller.handleAskAI(makeRequest());

    // Registering the run marks the placeholder node as being written.
    expect(h.lastWritingIndexes()).toEqual([1]);

    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    expect(h.calls[0].body).toMatchObject({
      content: "guardrail-wrapped question",
      conversation: "conv-1",
      contextual_tools: {},
      ui_context: {
        notebooks: [
          {
            type: "notebook",
            id: "nb-short",
            name: "My notebook",
            markdown_with_insertion_placeholder: INITIAL_MARKDOWN,
            insertion_placeholder_block_id: "conv-1",
            insertion_placeholder_marker: NOTEBOOK_AI_WRITING_PLACEHOLDER,
          },
        ],
      },
    });
    expect(h.calls[0].body.trace_id).toEqual(expect.any(String));

    // Non-content events and non-assistant messages are ignored.
    h.sse.emit("conversation", { id: "conv-1", status: "in_progress" });
    h.sse.emit("status", { type: "ack" });
    h.sse.emit("message", {
      id: "h1",
      type: "human",
      content: "guardrail-wrapped question",
    });
    h.sse.emit("message", {
      id: "t1",
      type: "tool",
      content: "",
      tool_calls: [],
    });

    // Assistant ticks re-send the FULL accumulated content each time.
    h.sse.emit("message", { id: "m1", type: "ai", content: "First paragraph" });
    await vi.waitFor(() => {
      expect(h.markdown()).toContain("First paragraph");
    });
    expect(h.markdown()).not.toContain(NOTEBOOK_AI_WRITING_PLACEHOLDER);
    expect(h.lastWritingIndexes()).toEqual([1]);

    h.sse.emit("message", {
      id: "m1",
      type: "ai",
      content: "First paragraph\n\nSecond paragraph",
    });
    await vi.waitFor(() => {
      expect(h.markdown()).toContain("Second paragraph");
    });
    expect(h.markdown()).toContain("First paragraph");
    expect(h.lastWritingIndexes()).toEqual([1, 2]);

    h.sse.close();
    await vi.waitFor(() => {
      expect(h.markdown()).toContain(NOTEBOOK_AI_FOLLOW_UP_PROMPT_MARKDOWN);
    });
    // Document order: title, response paragraphs, then the follow-up prompt.
    const md = h.markdown();
    expect(md.indexOf("# Title")).toBeLessThan(md.indexOf("First paragraph"));
    expect(md.indexOf("Second paragraph")).toBeLessThan(
      md.indexOf(NOTEBOOK_AI_FOLLOW_UP_PROMPT_MARKDOWN),
    );
    expect(h.lastWritingIndexes()).toEqual([]);
    expect(h.promptFocusRequests()).toBe(1);
  });

  it("joins data frames that span multiple lines", async () => {
    const h = createHarness();
    h.controller.handleAskAI(makeRequest());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));

    h.sse.emitRaw(": keep-alive comment\n");
    h.sse.emitRaw('event: message\ndata: {"id":"m1","type":"ai",\n');
    h.sse.emitRaw('data: "content":"Hello world"}\n\n');
    await vi.waitFor(() => {
      expect(h.markdown()).toContain("Hello world");
    });
  });

  it("replaces the placeholder with an error on an ai/failure message", async () => {
    const h = createHarness();
    h.controller.handleAskAI(makeRequest());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));

    h.sse.emit("message", { id: "f1", type: "ai/failure", content: "boom" });
    await vi.waitFor(() => {
      expect(h.markdown()).toContain("Something went wrong asking AI: boom");
    });
    expect(h.markdown()).not.toContain(NOTEBOOK_AI_WRITING_PLACEHOLDER);
    expect(h.markdown()).not.toContain(NOTEBOOK_AI_FOLLOW_UP_PROMPT_MARKDOWN);
    expect(h.lastWritingIndexes()).toEqual([]);
    expect(h.promptFocusRequests()).toBe(0);
    // The turn is over; the stream fetch is torn down too.
    expect(h.calls[0].signal.aborted).toBe(true);
  });

  it("replaces the placeholder with an error when the request itself fails", async () => {
    const h = createHarness({
      startConversationStream: async () => {
        throw new Error("network unreachable");
      },
    });
    h.controller.handleAskAI(makeRequest());
    await vi.waitFor(() => {
      expect(h.markdown()).toContain(
        "Something went wrong asking AI: network unreachable",
      );
    });
    expect(h.lastWritingIndexes()).toEqual([]);
  });

  it("treats a stream that ends without assistant content as an error", async () => {
    const h = createHarness();
    h.controller.handleAskAI(makeRequest());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));

    h.sse.emit("status", { type: "ack" });
    h.sse.close();
    await vi.waitFor(() => {
      expect(h.markdown()).toContain(
        "Something went wrong asking AI: the response was empty",
      );
    });
    expect(h.lastWritingIndexes()).toEqual([]);
  });

  it("rebases the response range through user edits made mid-stream", async () => {
    const h = createHarness();
    h.controller.handleAskAI(makeRequest());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));

    h.sse.emit("message", {
      id: "m1",
      type: "ai",
      content: "Alpha beta gamma content here",
    });
    await vi.waitFor(() => {
      expect(h.markdown()).toContain("Alpha beta gamma content here");
    });
    expect(h.lastWritingIndexes()).toEqual([1]);

    // The user types a new paragraph above the title while AI is writing.
    h.applyUserEdit(`Intro paragraph typed by the user.\n\n${h.markdown()}`);
    expect(h.lastWritingIndexes()).toEqual([2]);

    // The next tick lands in the shifted range without clobbering the edit.
    h.sse.emit("message", {
      id: "m1",
      type: "ai",
      content: "Alpha beta gamma content here, and more.",
    });
    await vi.waitFor(() => {
      expect(h.markdown()).toContain(
        "Alpha beta gamma content here, and more.",
      );
    });
    const md = h.markdown();
    expect(md).toContain("Intro paragraph typed by the user.");
    expect(md.indexOf("Intro paragraph typed by the user.")).toBeLessThan(
      md.indexOf("# Title"),
    );
    expect(md.indexOf("# Title")).toBeLessThan(md.indexOf("Alpha beta gamma"));
    expect(md).not.toContain("Alpha beta gamma content here\n");

    h.sse.close();
    await vi.waitFor(() => {
      expect(h.markdown()).toContain(NOTEBOOK_AI_FOLLOW_UP_PROMPT_MARKDOWN);
    });
    expect(h.markdown()).toContain("Intro paragraph typed by the user.");
  });

  it("dispose aborts in-flight runs, cancels the conversation, and weaves nothing", async () => {
    const h = createHarness();
    h.controller.handleAskAI(makeRequest());
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    expect(h.calls[0].signal.aborted).toBe(false);

    h.controller.dispose();
    expect(h.calls[0].signal.aborted).toBe(true);
    expect(h.cancelledConversations).toEqual(["conv-1"]);
    expect(h.lastWritingIndexes()).toEqual([]);

    // Let any pending stream reads settle: no error is woven, the placeholder
    // stays for the autosaved document.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.markdown()).toBe(INITIAL_MARKDOWN);

    // Disposed controllers refuse new runs.
    h.controller.handleAskAI(makeRequest({ conversationId: "conv-2" }));
    expect(h.calls).toHaveLength(1);
  });
});
