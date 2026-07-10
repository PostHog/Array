import type { AcpMessage } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import { analyzeAutoresearchActivity } from "./autoresearchActivity";

function updateEvent(ts: number, update: Record<string, unknown>): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: { update },
    },
  } as AcpMessage;
}

describe("analyzeAutoresearchActivity", () => {
  it("extracts the current plan and classifies observable work", () => {
    const events = [
      updateEvent(2_000, {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "```autoresearch\ntype: plan\nhypothesis: selectors cause rerenders\nplan: memoize selectors and benchmark\napproach: rendering\n```",
        },
      }),
      updateEvent(3_000, {
        sessionUpdate: "tool_call",
        title: "Search for selectors",
        kind: "search",
        status: "completed",
      }),
      updateEvent(5_000, {
        sessionUpdate: "tool_call",
        title: "Edit selector module",
        kind: "edit",
        status: "completed",
      }),
      updateEvent(8_000, {
        sessionUpdate: "tool_call",
        title: "Run benchmark",
        kind: "execute",
        status: "in_progress",
      }),
    ];

    const result = analyzeAutoresearchActivity(events, 1_000, null, 11_000);

    expect(result.currentPlan).toEqual({
      hypothesis: "selectors cause rerenders",
      plan: "memoize selectors and benchmark",
      approach: "rendering",
    });
    expect(result.items.map((item) => item.kind)).toEqual([
      "measurement",
      "implementation",
      "research",
    ]);
    expect(result.items[0]).toMatchObject({
      label: "Run benchmark",
      active: true,
    });
    expect(result.timeByKind).toEqual({
      reasoning: 2_000,
      research: 2_000,
      implementation: 3_000,
      measurement: 3_000,
    });
  });

  it("excludes activity after a historical run ended", () => {
    const events = [
      updateEvent(2_000, {
        sessionUpdate: "tool_call",
        title: "Run benchmark",
        kind: "execute",
        status: "completed",
      }),
      updateEvent(6_000, {
        sessionUpdate: "tool_call",
        title: "Later manual edit",
        kind: "edit",
        status: "completed",
      }),
    ];

    const result = analyzeAutoresearchActivity(events, 1_000, 4_000, 10_000);

    expect(result.items).toEqual([
      expect.objectContaining({ label: "Run benchmark" }),
    ]);
    expect(result.timeByKind).toEqual({
      reasoning: 1_000,
      research: 0,
      implementation: 0,
      measurement: 2_000,
    });
  });
});
