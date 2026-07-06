import type { AcpMessage } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  createContextUsageTracker,
  DEFAULT_STALE_COSTLY_THRESHOLD,
  extractContextUsage,
  extractLastActivityAt,
  shouldWarnStaleCostlyConversation,
} from "./contextUsage";

function usageUpdateEvent(used: number, size: number): AcpMessage {
  return {
    type: "acp_message",
    ts: 1,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: { sessionUpdate: "usage_update", used, size },
      },
    },
  };
}

function sizelessUsageUpdateEvent(used: number): AcpMessage {
  return {
    type: "acp_message",
    ts: 1,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: { sessionUpdate: "usage_update", used },
      },
    },
  };
}

function breakdownEvent(
  breakdown: Record<string, number>,
  method = "_posthog/usage_update",
): AcpMessage {
  return {
    type: "acp_message",
    ts: 1,
    message: { jsonrpc: "2.0", method, params: { sessionId: "s1", breakdown } },
  };
}

function agentChunkEvent(): AcpMessage {
  return {
    type: "acp_message",
    ts: 1,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: { sessionUpdate: "agent_message_chunk", content: "hello" },
      },
    },
  };
}

describe("extractContextUsage", () => {
  it("returns null with no usage event", () => {
    expect(extractContextUsage([])).toBeNull();
  });

  it("derives aggregate from the latest session/update", () => {
    const result = extractContextUsage([usageUpdateEvent(50_000, 200_000)]);
    expect(result?.used).toBe(50_000);
    expect(result?.size).toBe(200_000);
    expect(result?.percentage).toBe(25);
    expect(result?.breakdown).toBeNull();
  });

  it("surfaces token count even when the context window size is unknown", () => {
    // codex omits `size` when the protocol has no modelContextWindow — the
    // aggregate must still render (size 0, no percentage) rather than vanish.
    const event: AcpMessage = {
      type: "acp_message",
      ts: 1,
      message: {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          update: { sessionUpdate: "usage_update", used: 50_000 },
        },
      },
    };
    const result = extractContextUsage([event]);
    expect(result?.used).toBe(50_000);
    expect(result?.size).toBe(0);
    expect(result?.percentage).toBe(0);
  });

  it("borrows the context window from an older update when the newest omits it", () => {
    const result = extractContextUsage([
      usageUpdateEvent(50_000, 200_000),
      sizelessUsageUpdateEvent(60_000),
    ]);
    expect(result?.used).toBe(60_000);
    expect(result?.size).toBe(200_000);
    expect(result?.percentage).toBe(30);
  });

  it("merges breakdown from a _posthog/usage_update notification", () => {
    const result = extractContextUsage([
      usageUpdateEvent(50_000, 200_000),
      breakdownEvent({
        systemPrompt: 4000,
        tools: 500,
        rules: 0,
        skills: 0,
        mcp: 0,
        subagents: 0,
        conversation: 45_500,
      }),
    ]);
    expect(result?.breakdown?.systemPrompt).toBe(4000);
    expect(result?.breakdown?.conversation).toBe(45_500);
  });

  it("tolerates the double-underscore method prefix from extNotification", () => {
    const result = extractContextUsage([
      usageUpdateEvent(50_000, 200_000),
      breakdownEvent(
        {
          systemPrompt: 4000,
          tools: 0,
          rules: 0,
          skills: 0,
          mcp: 0,
          subagents: 0,
          conversation: 46_000,
        },
        "__posthog/usage_update",
      ),
    ]);
    expect(result?.breakdown?.systemPrompt).toBe(4000);
  });
});

describe("createContextUsageTracker", () => {
  it("processes only appended events on the append-only path", () => {
    const tracker = createContextUsageTracker();
    const firstEvent = usageUpdateEvent(50_000, 200_000);

    expect(tracker.update([firstEvent])?.used).toBe(50_000);

    Object.defineProperty(firstEvent, "message", {
      get: () => {
        throw new Error("old event was rescanned");
      },
    });

    const result = tracker.update([firstEvent, agentChunkEvent()]);
    expect(result?.used).toBe(50_000);
    expect(result?.size).toBe(200_000);
  });

  it("keeps the last known context window when an update omits size", () => {
    const tracker = createContextUsageTracker();
    const withSize = usageUpdateEvent(50_000, 200_000);

    expect(tracker.update([withSize])?.size).toBe(200_000);

    const result = tracker.update([withSize, sizelessUsageUpdateEvent(60_000)]);
    expect(result?.used).toBe(60_000);
    expect(result?.size).toBe(200_000);
    expect(result?.percentage).toBe(30);
  });

  it("rebuilds when the event list is truncated", () => {
    const tracker = createContextUsageTracker();
    const earlier = usageUpdateEvent(50_000, 200_000);
    const later = usageUpdateEvent(80_000, 200_000);

    expect(tracker.update([earlier, later])?.used).toBe(80_000);
    // Dropping the latest usage event must lower the reported value, not keep
    // the stale append-path total.
    expect(tracker.update([earlier])?.used).toBe(50_000);
  });

  it("rebuilds when the tail changes at the same length", () => {
    const tracker = createContextUsageTracker();
    const first = usageUpdateEvent(50_000, 200_000);
    const replaced = usageUpdateEvent(30_000, 200_000);

    tracker.update([first, usageUpdateEvent(80_000, 200_000)]);
    const events = [first, replaced];
    expect(tracker.update(events)).toEqual(extractContextUsage(events));
  });
});

describe("shouldWarnStaleCostlyConversation", () => {
  const now = 1_000_000_000;
  const threshold = { tokens: 40_000, staleMs: 5 * 60 * 1000 };

  it.each([
    {
      name: "large + stale → warn",
      usedTokens: 50_000,
      idleMs: 10 * 60 * 1000,
      expected: true,
    },
    {
      name: "large + fresh → no warn",
      usedTokens: 50_000,
      idleMs: 60 * 1000,
      expected: false,
    },
    {
      name: "small + stale → no warn",
      usedTokens: 10_000,
      idleMs: 10 * 60 * 1000,
      expected: false,
    },
    {
      name: "small + fresh → no warn",
      usedTokens: 10_000,
      idleMs: 60 * 1000,
      expected: false,
    },
    {
      name: "exactly at both thresholds → warn",
      usedTokens: 40_000,
      idleMs: 5 * 60 * 1000,
      expected: true,
    },
    {
      name: "one token below the size threshold → no warn",
      usedTokens: 39_999,
      idleMs: 10 * 60 * 1000,
      expected: false,
    },
    {
      name: "one ms below the stale threshold → no warn",
      usedTokens: 50_000,
      idleMs: 5 * 60 * 1000 - 1,
      expected: false,
    },
  ])("$name", ({ usedTokens, idleMs, expected }) => {
    expect(
      shouldWarnStaleCostlyConversation({
        usedTokens,
        lastActivityAt: now - idleMs,
        now,
        threshold,
      }),
    ).toBe(expected);
  });

  it("never warns without a last-activity timestamp", () => {
    expect(
      shouldWarnStaleCostlyConversation({
        usedTokens: 1_000_000,
        lastActivityAt: null,
        now,
        threshold,
      }),
    ).toBe(false);
  });

  it("treats a future timestamp (clock skew) as fresh", () => {
    expect(
      shouldWarnStaleCostlyConversation({
        usedTokens: 50_000,
        lastActivityAt: now + 60_000,
        now,
        threshold,
      }),
    ).toBe(false);
  });

  it("falls back to DEFAULT_STALE_COSTLY_THRESHOLD when none is given", () => {
    expect(
      shouldWarnStaleCostlyConversation({
        usedTokens: DEFAULT_STALE_COSTLY_THRESHOLD.tokens,
        lastActivityAt: now - DEFAULT_STALE_COSTLY_THRESHOLD.staleMs,
        now,
      }),
    ).toBe(true);
  });
});

describe("extractLastActivityAt", () => {
  it("returns null for an empty event list", () => {
    expect(extractLastActivityAt([])).toBeNull();
  });

  it("returns the ts of the most recent event", () => {
    const events: AcpMessage[] = [
      { ...agentChunkEvent(), ts: 10 },
      { ...usageUpdateEvent(50_000, 200_000), ts: 20 },
    ];
    expect(extractLastActivityAt(events)).toBe(20);
  });

  it("returns the maximum ts even when events are out of order", () => {
    const events: AcpMessage[] = [
      { ...usageUpdateEvent(50_000, 200_000), ts: 30 },
      { ...agentChunkEvent(), ts: 10 },
    ];
    expect(extractLastActivityAt(events)).toBe(30);
  });
});
