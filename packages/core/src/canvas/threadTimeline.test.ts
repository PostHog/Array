import { describe, expect, it } from "vitest";
import {
  buildThreadTimeline,
  deriveThreadAgentStatus,
  hasAgentMention,
  normalizeAgentPromptText,
  shouldSuspendThreadSession,
  visibleThreadMessages,
} from "./threadTimeline";

describe("hasAgentMention", () => {
  it.each([
    ["at the start", "@agent investigate this", true],
    ["after other text", "Could you @Agent check this?", true],
    ["inside an email-like token", "person@agent.com", false],
    ["as part of a longer handle", "@agents", false],
    ["without a mention", "human-only note", false],
  ])("detects an agent mention %s", (_name, content, expected) => {
    expect(hasAgentMention(content)).toBe(expected);
  });
});

describe("normalizeAgentPromptText", () => {
  it.each([
    [
      "forwarded thread comment",
      "[Thread comment from Peter Kirkham] @agent which model are you?",
      "which model are you?",
    ],
    ["direct prompt", "which model are you?", "which model are you?"],
    [
      "direct prompt with mention",
      "@agent which model are you?",
      "which model are you?",
    ],
  ])("normalizes a %s", (_name, content, expected) => {
    expect(normalizeAgentPromptText(content)).toBe(expected);
  });
});

describe("buildThreadTimeline", () => {
  it("omits the session echo of a forwarded thread message", () => {
    const timeline = buildThreadTimeline({
      prompts: [
        {
          id: "prompt",
          text: "[Thread comment from Peter Kirkham] @agent which model are you?",
          timestamp: 200,
        },
      ],
      humanMessages: [
        {
          id: "human",
          content: "@agent which model are you?",
          createdAt: "1970-01-01T00:00:00.100Z",
          forwardedToAgent: true,
        },
      ],
      agentMessages: [],
    });

    expect(timeline.map((row) => row.kind)).toEqual(["human"]);
  });

  it("keeps a thread-comment prompt without a matching forwarded message", () => {
    const timeline = buildThreadTimeline({
      prompts: [
        {
          id: "prompt",
          text: "[Thread comment from Peter Kirkham] @agent which model are you?",
          timestamp: 200,
        },
      ],
      humanMessages: [],
      agentMessages: [],
    });

    expect(timeline.map((row) => row.kind)).toEqual(["prompt"]);
  });

  it("interleaves prompts, human replies, and agent turns chronologically", () => {
    const timeline = buildThreadTimeline({
      prompts: [{ id: "prompt", text: "Start", timestamp: 100 }],
      humanMessages: [
        {
          id: "human",
          content: "Reply",
          createdAt: "1970-01-01T00:00:00.150Z",
        },
      ],
      agentMessages: [{ id: "agent", text: "Done", timestamp: 200 }],
    });

    expect(timeline.map((row) => row.kind)).toEqual([
      "prompt",
      "human",
      "agent",
    ]);
  });

  it("keeps malformed timestamps at the end", () => {
    const timeline = buildThreadTimeline({
      prompts: [{ id: "prompt", text: "Start", timestamp: 100 }],
      humanMessages: [{ id: "human", content: "Reply", createdAt: "invalid" }],
      agentMessages: [{ id: "agent", text: "Done", timestamp: 200 }],
    });

    expect(timeline.map((row) => row.kind)).toEqual([
      "prompt",
      "agent",
      "human",
    ]);
  });
});

describe("deriveThreadAgentStatus", () => {
  it.each([
    {
      name: "returns no status before activity",
      input: {},
      expected: null,
    },
    {
      name: "prioritizes failures",
      input: { hasActivity: true, hasError: true, errorTitle: "Run failed" },
      expected: { phase: "error", label: "Run failed" },
    },
    {
      name: "prioritizes pending permissions over active work",
      input: {
        hasActivity: true,
        pendingPermissionCount: 1,
        isPromptPending: true,
      },
      expected: { phase: "needs_input", label: "Needs input" },
    },
    {
      name: "reports active work",
      input: { hasActivity: true, isPromptPending: true },
      expected: { phase: "active", label: "Working…" },
    },
    {
      name: "returns no status after work settles",
      input: { hasActivity: true },
      expected: null,
    },
  ])("$name", ({ input, expected }) => {
    expect(deriveThreadAgentStatus(input)).toEqual(expected);
  });
});

describe("shouldSuspendThreadSession", () => {
  it("suspends a local runless task so reading cannot start work", () => {
    expect(
      shouldSuspendThreadSession({
        isCloud: false,
        hasRun: false,
        hasSession: false,
      }),
    ).toBe(true);
  });

  it.each([
    { isCloud: true, hasRun: false, hasSession: false },
    { isCloud: false, hasRun: true, hasSession: false },
    { isCloud: false, hasRun: false, hasSession: true },
  ])("keeps an existing or cloud session attached", (input) => {
    expect(shouldSuspendThreadSession(input)).toBe(false);
  });
});

describe("visibleThreadMessages", () => {
  const human = { id: "h", author_kind: "human" as const };
  const turn = (runId: string, id = `turn-${runId}`) => ({
    id,
    author_kind: "agent" as const,
    event: "turn_complete",
    payload: { run_id: runId },
  });

  it("keeps everything when no run is streaming", () => {
    expect(
      visibleThreadMessages([human, turn("run-1")], undefined).map((m) => m.id),
    ).toEqual(["h", "turn-run-1"]);
  });

  it("drops the durable turn for the run being streamed", () => {
    expect(
      visibleThreadMessages([human, turn("run-1")], "run-1").map((m) => m.id),
    ).toEqual(["h"]);
  });

  it("keeps durable turns from other runs", () => {
    expect(
      visibleThreadMessages([turn("run-1"), turn("run-2")], "run-1").map(
        (m) => m.id,
      ),
    ).toEqual(["turn-run-2"]);
  });

  it("never drops human messages", () => {
    expect(visibleThreadMessages([human], "run-1").map((m) => m.id)).toEqual([
      "h",
    ]);
  });

  it("keeps other agent rows — only turn_complete collides with a live turn", () => {
    const ask = {
      id: "ask",
      author_kind: "agent" as const,
      event: "permission_request",
      payload: { run_id: "run-1" },
    };
    expect(visibleThreadMessages([ask], "run-1").map((m) => m.id)).toEqual([
      "ask",
    ]);
  });

  it("keeps a turn row with no run id rather than dropping the only copy", () => {
    const orphan = {
      id: "orphan",
      author_kind: "agent" as const,
      event: "turn_complete",
      payload: {},
    };
    expect(visibleThreadMessages([orphan], "run-1").map((m) => m.id)).toEqual([
      "orphan",
    ]);
  });
});
