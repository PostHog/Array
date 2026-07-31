import { describe, expect, it } from "vitest";
import { buildHostsQuery, shapeUrlSuggestions } from "./productSuggestions";

describe("buildHostsQuery", () => {
  it("aggregates pageview hosts over the last 7 days", () => {
    const sql = buildHostsQuery();
    expect(sql).toContain("properties.$host");
    expect(sql).toContain("'$pageview'");
    expect(sql).toContain("INTERVAL 7 DAY");
    expect(sql).toMatch(/LIMIT \d+/);
  });
});

describe("shapeUrlSuggestions", () => {
  it("merges app_urls and pageview hosts, app_urls first", () => {
    const suggestions = shapeUrlSuggestions(
      ["https://us.posthog.com", "https://posthog.com"],
      [
        ["us.posthog.com", 120000],
        ["app.example.com", 500],
      ],
    );
    expect(suggestions.map((s) => s.url)).toEqual([
      "https://us.posthog.com",
      "https://posthog.com",
      "https://app.example.com",
    ]);
    expect(suggestions[0].source).toBe("app_urls");
    expect(suggestions[2]).toMatchObject({
      source: "pageview_hosts",
      eventCount: 500,
    });
  });

  it("dedupes hosts already covered by app_urls", () => {
    const suggestions = shapeUrlSuggestions(
      ["https://us.posthog.com"],
      [["us.posthog.com", 99]],
    );
    expect(suggestions).toHaveLength(1);
  });

  it("drops invalid app_urls and malformed host rows", () => {
    const suggestions = shapeUrlSuggestions(
      ["not a url", "https://ok.example", 42 as unknown as string],
      [
        [null, 1],
        ["", 2],
        ["good.example", 3],
      ],
    );
    expect(suggestions.map((s) => s.url)).toEqual([
      "https://ok.example",
      "https://good.example",
    ]);
  });

  it("keeps a wildcard-free origin only (strips paths, keeps localhost ports)", () => {
    const suggestions = shapeUrlSuggestions(
      ["https://app.example.com/replay/*"],
      [["localhost:8010", 10]],
    );
    expect(suggestions.map((s) => s.url)).toEqual([
      "https://app.example.com",
      "http://localhost:8010",
    ]);
  });

  it("uses http for localhost hosts and https for everything else", () => {
    const suggestions = shapeUrlSuggestions(
      [],
      [
        ["127.0.0.1:3000", 5],
        ["prod.example.com", 9],
      ],
    );
    expect(suggestions.map((s) => s.url)).toEqual([
      "http://127.0.0.1:3000",
      "https://prod.example.com",
    ]);
  });
});
