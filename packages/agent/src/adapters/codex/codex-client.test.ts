import type {
  AgentSideConnection,
  ReadTextFileRequest,
  ReadTextFileResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { describe, expect, test, vi } from "vitest";
import type { FileEnrichmentDeps } from "../../enrichment/file-enricher";
import { Logger } from "../../utils/logger";

const enrichFileMock = vi.hoisted(() => vi.fn());
vi.mock("../../enrichment/file-enricher", () => ({
  enrichFileForAgent: enrichFileMock,
}));

import { createCodexClient } from "./codex-client";
import { createSessionState } from "./session-state";

function makeUpstream(response: ReadTextFileResponse): AgentSideConnection & {
  readTextFile: ReturnType<typeof vi.fn>;
} {
  const mock = {
    readTextFile: vi.fn(async (_: ReadTextFileRequest) => response),
    writeTextFile: vi.fn(),
    requestPermission: vi.fn(),
    sessionUpdate: vi.fn(),
    createTerminal: vi.fn(),
    terminalOutput: vi.fn(),
    releaseTerminal: vi.fn(),
    waitForTerminalExit: vi.fn(),
    killTerminal: vi.fn(),
    extMethod: vi.fn(),
    extNotification: vi.fn(),
  };
  return mock as unknown as AgentSideConnection & {
    readTextFile: ReturnType<typeof vi.fn>;
  };
}

describe("createCodexClient readTextFile", () => {
  const logger = new Logger({ debug: false, prefix: "[test]" });
  const sessionState = createSessionState("", "/tmp");

  test("returns upstream response unchanged when enrichmentDeps is absent", async () => {
    enrichFileMock.mockReset();
    const upstream = makeUpstream({ content: "const x = 1;" });
    const client = createCodexClient(upstream, logger, sessionState);

    const result = await client.readTextFile?.({
      sessionId: "s",
      path: "/tmp/a.ts",
    });
    expect(result?.content).toBe("const x = 1;");
    expect(enrichFileMock).not.toHaveBeenCalled();
  });

  test("returns enriched content when helper returns a string", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce("const x = 1; // [PostHog] Flag ...");

    const upstream = makeUpstream({ content: "const x = 1;" });
    const deps = {} as FileEnrichmentDeps;
    const client = createCodexClient(upstream, logger, sessionState, {
      enrichmentDeps: deps,
    });

    const result = await client.readTextFile?.({
      sessionId: "s",
      path: "/tmp/a.ts",
    });
    expect(result?.content).toBe("const x = 1; // [PostHog] Flag ...");
    expect(enrichFileMock).toHaveBeenCalledWith(
      deps,
      "/tmp/a.ts",
      "const x = 1;",
    );
  });

  test("falls back to upstream response when helper returns null", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce(null);

    const upstream = makeUpstream({ content: "no posthog here" });
    const client = createCodexClient(upstream, logger, sessionState, {
      enrichmentDeps: {} as FileEnrichmentDeps,
    });

    const result = await client.readTextFile?.({
      sessionId: "s",
      path: "/tmp/a.ts",
    });
    expect(result?.content).toBe("no posthog here");
  });

  test("calls upstream.readTextFile with original params (UI sees original)", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce("enriched");

    const upstream = makeUpstream({ content: "original" });
    const client = createCodexClient(upstream, logger, sessionState, {
      enrichmentDeps: {} as FileEnrichmentDeps,
    });

    const params = {
      sessionId: "s",
      path: "/tmp/a.ts",
      line: 10,
      limit: 5,
    };
    await client.readTextFile?.(params);
    expect(upstream.readTextFile).toHaveBeenCalledWith(params);
  });
});

describe("createCodexClient onStructuredOutput", () => {
  const logger = new Logger({ debug: false, prefix: "[test]" });
  const sessionState = createSessionState("sess", "/tmp");

  function makeUpstream(): AgentSideConnection {
    return {
      sessionUpdate: vi.fn(async () => {}),
      requestPermission: vi.fn(),
      readTextFile: vi.fn(),
      writeTextFile: vi.fn(),
      createTerminal: vi.fn(),
      terminalOutput: vi.fn(),
      releaseTerminal: vi.fn(),
      waitForTerminalExit: vi.fn(),
      killTerminal: vi.fn(),
      extMethod: vi.fn(),
      extNotification: vi.fn(),
    } as unknown as AgentSideConnection;
  }

  function notification(update: Record<string, unknown>): SessionNotification {
    return {
      sessionId: "sess",
      update,
    } as unknown as SessionNotification;
  }

  test("fires once when create_output completes after rawInput arrived", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "create_output",
        status: "in_progress",
        rawInput: { result: "ok", count: 5 },
      }),
    );
    expect(onStructuredOutput).not.toHaveBeenCalled();

    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        title: "create_output",
        status: "completed",
      }),
    );

    expect(onStructuredOutput).toHaveBeenCalledTimes(1);
    expect(onStructuredOutput).toHaveBeenCalledWith({ result: "ok", count: 5 });
  });

  test("matches mcp__-prefixed tool titles", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "mcp__posthog_output__create_output",
        status: "completed",
        rawInput: { ok: true },
      }),
    );

    expect(onStructuredOutput).toHaveBeenCalledWith({ ok: true });
  });

  test("ignores tool calls that aren't create_output", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Read",
        status: "completed",
        rawInput: { path: "/tmp/x" },
      }),
    );

    expect(onStructuredOutput).not.toHaveBeenCalled();
  });

  test("does not fire when rawInput never arrived", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "create_output",
        status: "completed",
      }),
    );

    expect(onStructuredOutput).not.toHaveBeenCalled();
  });

  test("does not fire twice if completed is re-emitted for the same tool call", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    const completed = notification({
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      title: "create_output",
      status: "completed",
      rawInput: { final: 1 },
    });

    await client.sessionUpdate?.(completed);
    await client.sessionUpdate?.(completed);

    expect(onStructuredOutput).toHaveBeenCalledTimes(1);
  });

  test("forwards the notification upstream regardless of structured-output handling", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    const note = notification({
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      title: "create_output",
      status: "completed",
      rawInput: { final: 1 },
    });
    await client.sessionUpdate?.(note);

    expect(upstream.sessionUpdate).toHaveBeenCalledWith(note);
  });

  test("does nothing when the callback is not wired", async () => {
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState);

    // No onStructuredOutput configured — must not throw and must still
    // forward upstream.
    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "create_output",
        status: "completed",
        rawInput: { x: 1 },
      }),
    );

    expect(upstream.sessionUpdate).toHaveBeenCalledTimes(1);
  });
});
