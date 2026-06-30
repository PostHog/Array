import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { QuestionMetaSchema } from "../claude/questions/utils";
import { handleServerRequest } from "./approvals";
import { APP_SERVER_REQUESTS } from "./protocol";

// A fake ACP client whose requestPermission returns whatever the test queues,
// matched positionally to the order requestPermission is called.
function fakeClient(outcomes: RequestPermissionResponse["outcome"][]) {
  const calls: RequestPermissionRequest[] = [];
  let next = 0;
  const requestPermission = vi.fn(
    async (
      params: RequestPermissionRequest,
    ): Promise<RequestPermissionResponse> => {
      calls.push(params);
      const outcome = outcomes[next++] ?? { outcome: "cancelled" as const };
      return { outcome };
    },
  );
  return { client: { requestPermission }, calls };
}

const opts = { sessionId: "sess-1" };

describe("handleServerRequest", () => {
  it("maps a requestUserInput question's selected option back to an answer", async () => {
    const { client, calls } = fakeClient([
      { outcome: "selected", optionId: "option_1" },
    ]);

    const params = {
      threadId: "t",
      turnId: "turn",
      itemId: "item-9",
      autoResolutionMs: null,
      questions: [
        {
          id: "q1",
          header: "Pick one",
          question: "Which environment?",
          isOther: false,
          isSecret: false,
          options: [
            { label: "staging", description: "" },
            { label: "production", description: "danger" },
          ],
        },
      ],
    };

    const result = await handleServerRequest(
      APP_SERVER_REQUESTS.TOOL_USER_INPUT,
      params,
      client,
      opts,
    );

    expect(result.handled).toBe(true);
    expect(result.response).toEqual({
      answers: { q1: { answers: ["production"] } },
    });

    // Prompt carried the question's options and the session id.
    expect(calls).toHaveLength(1);
    expect(calls[0].sessionId).toBe("sess-1");
    expect(calls[0].options.map((o) => o.name)).toEqual([
      "staging",
      "production",
    ]);
  });

  it("carries a QuestionMetaSchema-valid questions array so the host card renders", async () => {
    const { client, calls } = fakeClient([
      { outcome: "selected", optionId: "option_0" },
    ]);

    const params = {
      threadId: "t",
      turnId: "turn",
      itemId: "item-1",
      autoResolutionMs: null,
      questions: [
        {
          id: "q1",
          header: "Environment",
          question: "Which environment?",
          isOther: false,
          isSecret: false,
          options: [
            { label: "staging", description: "" },
            { label: "production", description: "danger" },
          ],
        },
      ],
    };

    await handleServerRequest(
      APP_SERVER_REQUESTS.TOOL_USER_INPUT,
      params,
      client,
      opts,
    );

    // The bug: a bare `{ header }` _meta fails QuestionMetaSchema, so the host's
    // QuestionPermission renders an empty "Review your answers" screen.
    const parsed = QuestionMetaSchema.safeParse(calls[0].toolCall?._meta);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.questions).toEqual([
      {
        question: "Which environment?",
        header: "Environment",
        // The non-empty description rides along; the empty one is dropped.
        options: [
          { label: "staging" },
          { label: "production", description: "danger" },
        ],
      },
    ]);
  });

  it("defaults a cancelled question to an empty answer", async () => {
    const { client } = fakeClient([{ outcome: "cancelled" }]);

    const params = {
      threadId: "t",
      turnId: "turn",
      itemId: "item-1",
      autoResolutionMs: null,
      questions: [
        {
          id: "q1",
          header: "h",
          question: "q?",
          isOther: false,
          isSecret: false,
          options: [{ label: "a", description: "" }],
        },
      ],
    };

    const result = await handleServerRequest(
      APP_SERVER_REQUESTS.TOOL_USER_INPUT,
      params,
      client,
      opts,
    );

    expect(result.response).toEqual({ answers: { q1: { answers: [] } } });
  });

  it("grants the requested permission profile for the turn on allow", async () => {
    const { client } = fakeClient([{ outcome: "selected", optionId: "allow" }]);

    const params = {
      threadId: "t",
      turnId: "turn",
      itemId: "perm-1",
      environmentId: null,
      startedAtMs: 0,
      cwd: "/repo",
      reason: "needs network",
      permissions: {
        network: { enabled: true },
        fileSystem: null,
      },
    };

    const result = await handleServerRequest(
      APP_SERVER_REQUESTS.PERMISSIONS_APPROVAL,
      params,
      client,
      opts,
    );

    expect(result.handled).toBe(true);
    // "allow_once" click grants for the turn, not session-wide.
    expect(result.response).toEqual({
      permissions: { network: { enabled: true } },
      scope: "turn",
    });
  });

  it("fails closed to the safe default when a payload is malformed", async () => {
    // null params makes the handler throw on param access; it must deny, not raise.
    const { client } = fakeClient([{ outcome: "selected", optionId: "allow" }]);
    const result = await handleServerRequest(
      APP_SERVER_REQUESTS.PERMISSIONS_APPROVAL,
      null,
      client,
      opts,
    );
    expect(result).toEqual({
      handled: true,
      response: { permissions: {}, scope: "turn" },
    });
  });

  it("denies a permission request with an empty profile on reject", async () => {
    const { client } = fakeClient([
      { outcome: "selected", optionId: "reject" },
    ]);

    const params = {
      threadId: "t",
      turnId: "turn",
      itemId: "perm-2",
      environmentId: null,
      startedAtMs: 0,
      cwd: "/repo",
      reason: null,
      permissions: { network: { enabled: true }, fileSystem: null },
    };

    const result = await handleServerRequest(
      APP_SERVER_REQUESTS.PERMISSIONS_APPROVAL,
      params,
      client,
      opts,
    );

    expect(result.response).toEqual({ permissions: {}, scope: "turn" });
  });

  it("returns an accept elicitation response when the user accepts", async () => {
    const { client } = fakeClient([
      { outcome: "selected", optionId: "accept" },
    ]);

    const params = {
      threadId: "t",
      turnId: "turn",
      serverName: "posthog",
      mode: "form",
      message: "Confirm the export",
    };

    const result = await handleServerRequest(
      APP_SERVER_REQUESTS.MCP_ELICITATION,
      params,
      client,
      opts,
    );

    expect(result.handled).toBe(true);
    expect(result.response).toEqual({
      action: "accept",
      content: {},
      _meta: null,
    });
  });

  it("declines an elicitation when the user rejects", async () => {
    const { client } = fakeClient([
      { outcome: "selected", optionId: "decline" },
    ]);

    const result = await handleServerRequest(
      APP_SERVER_REQUESTS.MCP_ELICITATION,
      {
        threadId: "t",
        turnId: null,
        serverName: "x",
        mode: "url",
        message: "",
      },
      client,
      opts,
    );

    expect(result.response).toEqual({
      action: "decline",
      content: null,
      _meta: null,
    });
  });

  it("enriches an elicitation with the in-flight MCP tool call so the host renders the real tool", async () => {
    const { client, calls } = fakeClient([
      { outcome: "selected", optionId: "accept" },
    ]);

    await handleServerRequest(
      APP_SERVER_REQUESTS.MCP_ELICITATION,
      {
        threadId: "t",
        turnId: "turn",
        serverName: "posthog",
        mode: "form",
        message: 'Allow the posthog MCP server to run tool "exec"?',
      },
      client,
      {
        ...opts,
        resolveMcpToolCall: (serverName) =>
          serverName === "posthog"
            ? {
                server: "posthog",
                tool: "exec",
                args: { command: "search project|insight" },
              }
            : undefined,
      },
    );

    // The prompt now carries the real MCP tool + args + _meta.posthog (not
    // codex's bare "run tool exec" text), so the host renders the proper MCP
    // permission card with the unwrapped command.
    expect(calls[0].toolCall).toMatchObject({
      toolCallId: "posthog:elicitation",
      rawInput: { command: "search project|insight" },
      _meta: {
        posthog: {
          toolName: "mcp__posthog__exec",
          mcp: { server: "posthog", tool: "exec" },
        },
      },
    });
  });

  it("falls back to codex's generic elicitation text when no MCP call correlates", async () => {
    const { client, calls } = fakeClient([
      { outcome: "selected", optionId: "decline" },
    ]);

    await handleServerRequest(
      APP_SERVER_REQUESTS.MCP_ELICITATION,
      {
        threadId: "t",
        turnId: "t",
        serverName: "posthog",
        mode: "form",
        message: "Confirm",
      },
      client,
      // resolveMcpToolCall absent (e.g. server mismatch) → no enrichment.
      opts,
    );

    expect(calls[0].toolCall).not.toHaveProperty("_meta");
    expect(calls[0].toolCall).toMatchObject({
      toolCallId: "posthog:elicitation",
      title: "Confirm",
    });
  });

  it("returns handled:false for the simple command approval (caller owns it)", async () => {
    const { client, calls } = fakeClient([]);

    const result = await handleServerRequest(
      APP_SERVER_REQUESTS.COMMAND_APPROVAL,
      { itemId: "x", command: "ls" },
      client,
      opts,
    );

    expect(result).toEqual({ handled: false, response: undefined });
    expect(calls).toHaveLength(0);
  });

  it("returns handled:false for an unknown method", async () => {
    const { client } = fakeClient([]);

    const result = await handleServerRequest(
      "some/unknown/method",
      {},
      client,
      opts,
    );

    expect(result).toEqual({ handled: false, response: undefined });
  });
});
