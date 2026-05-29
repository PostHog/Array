import type { StoredLogEntry } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import { derivePendingPermissionRequests } from "./sessionService";

describe("derivePendingPermissionRequests", () => {
  const request = (requestId: string, toolCallId: string): StoredLogEntry => ({
    type: "notification",
    notification: {
      method: "_posthog/permission_request",
      params: {
        requestId,
        toolCallId,
        toolCall: { toolCallId, title: "Ready to code?" },
        options: [],
      },
    },
  });
  const resolved = (requestId: string): StoredLogEntry => ({
    type: "notification",
    notification: {
      method: "_posthog/permission_resolved",
      params: { requestId },
    },
  });

  it("returns only unanswered requests, carrying their requestId", () => {
    const pending = derivePendingPermissionRequests([
      request("r1", "t1"),
      resolved("r1"),
      request("r2", "t2"),
    ]);

    expect(pending.map((p) => p.requestId)).toEqual(["r2"]);
    expect(pending[0].toolCall.toolCallId).toBe("t2");
  });

  it("ignores unrelated entries and requests without a requestId", () => {
    const pending = derivePendingPermissionRequests([
      {
        type: "notification",
        notification: { method: "_posthog/console", params: {} },
      },
      {
        type: "notification",
        notification: { method: "_posthog/permission_request", params: {} },
      },
    ]);

    expect(pending).toEqual([]);
  });

  it("drops requests missing a toolCall so they never reach the handler", () => {
    const pending = derivePendingPermissionRequests([
      {
        type: "notification",
        notification: {
          method: "_posthog/permission_request",
          params: { requestId: "r1", options: [] },
        },
      },
    ]);

    expect(pending).toEqual([]);
  });
});
