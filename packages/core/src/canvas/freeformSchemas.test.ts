import { describe, expect, it } from "vitest";
import {
  canvasLiveEventsSubscribeInput,
  canvasToHostMessageSchema,
  hostToCanvasMessageSchema,
  liveEventPropertyFilterSchema,
} from "./freeformSchemas";

describe("canvasToHostMessageSchema open-external", () => {
  const message = (url: string) => ({
    channel: "posthog-canvas",
    type: "open-external",
    url,
  });

  it.each([
    "https://posthog.com/docs",
    "https://us.posthog.com/project/2",
    "https://app.posthog.com",
  ])("accepts %s", (url) => {
    expect(canvasToHostMessageSchema.safeParse(message(url)).success).toBe(
      true,
    );
  });

  it.each([
    "https://example.com",
    "http://posthog.com",
    "https://posthog.com.evil.com",
    "mailto:hi@posthog.com",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "/relative/path",
    "",
  ])("rejects %s", (url) => {
    expect(canvasToHostMessageSchema.safeParse(message(url)).success).toBe(
      false,
    );
  });
});

describe("live-event message round-trip", () => {
  it("accepts a live-subscribe frame with rich filters", () => {
    const parsed = canvasToHostMessageSchema.safeParse({
      channel: "posthog-canvas",
      type: "live-subscribe",
      subId: "live-1",
      params: {
        eventType: "$pageview",
        columns: ["$current_url", "$browser"],
        properties: [
          { key: "$browser", operator: "exact", value: "Chrome" },
          {
            key: "$current_url",
            operator: "icontains",
            value: ["docs", "blog"],
          },
          { key: "$geoip_country_code", operator: "is_set" },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a subscribe frame whose operator is outside the live allowlist", () => {
    const parsed = liveEventPropertyFilterSchema.safeParse({
      key: "$browser",
      operator: "contains_everything", // not a livestream-supported operator
      value: "x",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a live-event frame back into the iframe", () => {
    const parsed = hostToCanvasMessageSchema.safeParse({
      channel: "posthog-canvas",
      type: "live-event",
      subId: "live-1",
      event: {
        distinct_id: "user@example.com",
        event: "$pageview",
        timestamp: "2026-07-30T10:00:00.000Z",
        properties: { $current_url: "https://posthog.com/docs" },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a live-stream-status frame", () => {
    expect(
      hostToCanvasMessageSchema.safeParse({
        channel: "posthog-canvas",
        type: "live-stream-status",
        subId: "live-1",
        status: "error",
        message: "upstream closed",
      }).success,
    ).toBe(true);
  });

  it("rejects subscribe params with extra/garbage fields", () => {
    const parsed = canvasLiveEventsSubscribeInput.safeParse({
      eventType: 42, // must be a string
    });
    expect(parsed.success).toBe(false);
  });
});
