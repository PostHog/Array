import { describe, expect, it } from "vitest";
import { elementStatsQuery } from "./productInsights";

describe("elementStatsQuery", () => {
  it("scopes to the page path, all click types, last 7 days, bounded rows", () => {
    const qs = elementStatsQuery("/pricing");
    const params = new URLSearchParams(qs);
    expect(params.get("date_from")).toBe("-7d");
    expect(params.get("limit")).toBe("200");
    expect(JSON.parse(params.get("include") ?? "[]")).toEqual([
      "$autocapture",
      "$rageclick",
      "$dead_click",
    ]);
    expect(JSON.parse(params.get("properties") ?? "[]")).toEqual([
      { key: "$pathname", value: "/pricing", operator: "exact", type: "event" },
    ]);
  });

  it("safely encodes hostile pathnames (no filter injection)", () => {
    const qs = elementStatsQuery('/x"},{"key":"email"');
    const params = new URLSearchParams(qs);
    const properties = JSON.parse(params.get("properties") ?? "[]");
    expect(properties).toHaveLength(1);
    expect(properties[0].value).toBe('/x"},{"key":"email"');
  });

  it("caps pathological pathname lengths", () => {
    const qs = elementStatsQuery(`/${"a".repeat(5000)}`);
    const params = new URLSearchParams(qs);
    const properties = JSON.parse(params.get("properties") ?? "[]");
    expect((properties[0].value as string).length).toBeLessThanOrEqual(1000);
  });
});
