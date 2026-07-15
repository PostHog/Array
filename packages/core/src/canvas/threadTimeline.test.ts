import { describe, expect, it } from "vitest";
import {
  buildThreadTimeline,
  deriveThreadAgentStatus,
  shouldSuspendThreadSession,
} from "./threadTimeline";

describe("buildThreadTimeline", () => {
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
      name: "reports shipped work",
      input: { hasActivity: true, hasPullRequest: true },
      expected: { phase: "complete", label: "Shipped" },
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
