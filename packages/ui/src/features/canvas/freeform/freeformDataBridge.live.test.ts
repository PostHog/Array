import { describe, expect, it } from "vitest";
import { buildLiveEventsUrl, parseSseChunk } from "./freeformDataBridge";

describe("buildLiveEventsUrl", () => {
  const BASE = "https://live.us.posthog.com/events";

  it("passes no params when all are absent", () => {
    expect(buildLiveEventsUrl(BASE, {})).toBe(`${BASE}`);
  });

  it("adds eventType / distinctId / columns / properties like the app feed", () => {
    const url = new URL(
      buildLiveEventsUrl(BASE, {
        eventType: "$pageview",
        distinctId: "user@example.com",
        columns: ["$current_url", "$browser"],
        properties: [
          { key: "$browser", operator: "exact", value: "Chrome" },
          { key: "$geoip_country_code", operator: "is_set" },
        ],
      }),
    );
    expect(url.searchParams.get("eventType")).toBe("$pageview");
    expect(url.searchParams.get("distinctId")).toBe("user@example.com");
    expect(url.searchParams.get("columns")).toBe("$current_url,$browser");
    expect(JSON.parse(url.searchParams.get("properties") ?? "[]")).toEqual([
      { key: "$browser", operator: "exact", value: "Chrome" },
      { key: "$geoip_country_code", operator: "is_set" },
    ]);
  });

  it("omits empty columns and empty property arrays", () => {
    const url = new URL(
      buildLiveEventsUrl(BASE, { columns: [], properties: [] }),
    );
    expect(url.searchParams.has("columns")).toBe(false);
    expect(url.searchParams.has("properties")).toBe(false);
  });
});

describe("parseSseChunk", () => {
  it("extracts data payloads and ignores comments/ids", () => {
    const { payloads, tail } = parseSseChunk(
      'id: 12\n: keep-alive\ndata: {"a":1}\n\ndata: {"b":2}\n\n',
    );
    expect(payloads).toEqual(['{"a":1}', '{"b":2}']);
    expect(tail).toBe("");
  });

  it("keeps an incomplete trailing frame for the next chunk", () => {
    const first = parseSseChunk('data: {"a":1}\n\ndata: {"b"');
    expect(first.payloads).toEqual(['{"a":1}']);
    expect(first.tail).toBe('data: {"b"');
    const second = parseSseChunk(`${first.tail}:2}\n\n`);
    expect(second.payloads).toEqual(['{"b":2}']);
  });

  it("drops the [done] sentinel", () => {
    const { payloads } = parseSseChunk("data: [done]\n\n");
    expect(payloads).toEqual([]);
  });
});
