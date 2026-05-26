import type { AcpMessage } from "@shared/types/session-events";
import { describe, expect, it } from "vitest";
import { extractContextUsage } from "./useContextUsage";

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
