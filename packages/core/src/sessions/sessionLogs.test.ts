import type { AcpMessage } from "@posthog/shared";
import { describe, expect, it, vi } from "vitest";
import { parseSessionLogContent, planSkippedPromptFilter } from "./sessionLogs";

function promptEvent(id: number): AcpMessage {
  return { message: { id, method: "session/prompt" } } as AcpMessage;
}
function notifyEvent(method: string): AcpMessage {
  return { message: { method } } as AcpMessage;
}

describe("parseSessionLogContent", () => {
  it("parses one stored entry per line", () => {
    const content = [
      JSON.stringify({ type: "request", message: { id: 1 } }),
      JSON.stringify({ type: "notification", notification: { method: "x" } }),
    ].join("\n");

    const result = parseSessionLogContent(content);

    expect(result.rawEntries).toHaveLength(2);
    expect(result.totalLineCount).toBe(2);
    expect(result.parseFailureCount).toBe(0);
    expect(result.sessionId).toBeUndefined();
    expect(result.adapter).toBeUndefined();
  });

  it("extracts sessionId and adapter from a posthog/sdk_session notification", () => {
    const content = JSON.stringify({
      type: "notification",
      notification: {
        method: "_posthog/sdk_session",
        params: { sessionId: "sess-9", adapter: "codex" },
      },
    });

    const result = parseSessionLogContent(content);

    expect(result.sessionId).toBe("sess-9");
    expect(result.adapter).toBe("codex");
  });

  it("falls back to sdkSessionId when sessionId is absent", () => {
    const content = JSON.stringify({
      type: "notification",
      notification: {
        method: "agent/posthog/sdk_session",
        params: { sdkSessionId: "sdk-7" },
      },
    });

    expect(parseSessionLogContent(content).sessionId).toBe("sdk-7");
  });

  it("counts parse failures and invokes onParseError for each bad line", () => {
    const onParseError = vi.fn();
    const content = ["not json", JSON.stringify({ type: "request" })].join(
      "\n",
    );

    const result = parseSessionLogContent(content, { onParseError });

    expect(result.parseFailureCount).toBe(1);
    expect(result.rawEntries).toHaveLength(1);
    expect(onParseError).toHaveBeenCalledTimes(1);
    expect(onParseError).toHaveBeenCalledWith("not json");
  });
});

describe("planSkippedPromptFilter", () => {
  it("returns null when there is nothing to skip", () => {
    expect(planSkippedPromptFilter(0, [promptEvent(1)])).toBeNull();
    expect(planSkippedPromptFilter(undefined, [promptEvent(1)])).toBeNull();
  });

  it("returns null when no session/prompt event is present", () => {
    expect(
      planSkippedPromptFilter(2, [notifyEvent("a"), notifyEvent("b")]),
    ).toBeNull();
  });

  it("drops the first session/prompt event and decrements the skip count", () => {
    const events = [notifyEvent("a"), promptEvent(1), notifyEvent("b")];
    const plan = planSkippedPromptFilter(2, events);

    expect(plan).not.toBeNull();
    expect(plan?.remainingSkipCount).toBe(1);
    expect(plan?.events).toEqual([notifyEvent("a"), notifyEvent("b")]);
    expect(events).toHaveLength(3);
  });
});
