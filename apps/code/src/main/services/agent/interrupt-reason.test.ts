import { describe, expect, it } from "vitest";
import { applyInterruptReasonToCancelledResponse } from "./interrupt-reason";

describe("applyInterruptReasonToCancelledResponse", () => {
  it("injects the reason into a cancelled response that has none", () => {
    const message = {
      jsonrpc: "2.0",
      id: 7,
      result: { stopReason: "cancelled" },
    };

    applyInterruptReasonToCancelledResponse(message, "connection_lost");

    expect(
      (message.result as { _meta?: { interruptReason?: string } })._meta
        ?.interruptReason,
    ).toBe("connection_lost");
  });

  it("does not overwrite a reason the agent already provided", () => {
    const message = {
      result: {
        stopReason: "cancelled",
        _meta: { interruptReason: "moving_to_worktree" },
      },
    };

    applyInterruptReasonToCancelledResponse(message, "connection_lost");

    expect(message.result._meta.interruptReason).toBe("moving_to_worktree");
  });

  it("ignores non-cancelled responses", () => {
    const message = { result: { stopReason: "end_turn" } };

    applyInterruptReasonToCancelledResponse(message, "connection_lost");

    expect((message.result as { _meta?: unknown })._meta).toBeUndefined();
  });

  it("no-ops when there is no reason to apply", () => {
    const message = { result: { stopReason: "cancelled" } };

    applyInterruptReasonToCancelledResponse(message, undefined);

    expect((message.result as { _meta?: unknown })._meta).toBeUndefined();
  });
});
