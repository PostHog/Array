import type { AcpMessage } from "@shared/types/session-events";
import { describe, expect, it } from "vitest";
import { accumulateSessionResources } from "./accumulateSessionResources";

function resourcesUsedMsg(
  ts: number,
  products: { id: string; label: string }[],
): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "_posthog/resources_used",
      params: { sessionId: "session-1", products },
    },
  };
}

describe("accumulateSessionResources", () => {
  it("collects products across notifications in first-seen order", () => {
    const events: AcpMessage[] = [
      resourcesUsedMsg(1, [{ id: "feature_flags", label: "Feature flags" }]),
      resourcesUsedMsg(2, [
        { id: "product_analytics", label: "Product analytics" },
      ]),
    ];

    expect(accumulateSessionResources(events)).toEqual([
      { id: "feature_flags", label: "Feature flags" },
      { id: "product_analytics", label: "Product analytics" },
    ]);
  });

  it("de-duplicates a product used across multiple turns", () => {
    const events: AcpMessage[] = [
      resourcesUsedMsg(1, [{ id: "feature_flags", label: "Feature flags" }]),
      resourcesUsedMsg(2, [{ id: "experiments", label: "Experiments" }]),
      // feature_flags used again on a later turn — must not appear twice.
      resourcesUsedMsg(3, [{ id: "feature_flags", label: "Feature flags" }]),
    ];

    const result = accumulateSessionResources(events);
    expect(result).toEqual([
      { id: "feature_flags", label: "Feature flags" },
      { id: "experiments", label: "Experiments" },
    ]);
  });

  it("ignores unrelated events and empty payloads", () => {
    const events: AcpMessage[] = [
      {
        type: "acp_message",
        ts: 1,
        message: {
          jsonrpc: "2.0",
          method: "_posthog/turn_complete",
          params: { stopReason: "end_turn" },
        },
      },
      resourcesUsedMsg(2, []),
    ];

    expect(accumulateSessionResources(events)).toEqual([]);
  });
});
