import { describe, expect, it } from "vitest";
import {
  buildElementChainFragment,
  buildElementErrorsQuery,
  buildElementSessionsQuery,
  buildElementTrendQuery,
  buildPageVitalsQuery,
  elementStatsQuery,
  shapeErrorRows,
  shapeSessionRows,
  shapeTrendRows,
  shapeVitalsRow,
} from "./productInsights";

const element = {
  selectorHash: "h",
  tag: "a",
  dataAttr: null,
  id: null,
  classes: [],
  href: "https://us.posthog.com",
  text: "Open PostHog",
  nthChildPath: "a:1",
};

describe("buildElementChainFragment", () => {
  it("prefers data-attr, then id, then href, then text", () => {
    expect(
      buildElementChainFragment({ ...element, dataAttr: "save-button" }),
    ).toBe('%attr__data-attr="save-button"%');
    expect(buildElementChainFragment({ ...element, id: "cta" })).toBe(
      '%attr__id="cta"%',
    );
    expect(buildElementChainFragment(element)).toBe(
      '%href="https://us.posthog.com"%',
    );
    expect(buildElementChainFragment({ ...element, href: null })).toBe(
      '%text="Open PostHog"%',
    );
  });

  it("returns null when the element has no usable key", () => {
    expect(
      buildElementChainFragment({ ...element, href: null, text: null }),
    ).toBeNull();
  });

  it("escapes quotes, backslashes, and LIKE wildcards from page-derived values", () => {
    const fragment = buildElementChainFragment({
      ...element,
      dataAttr: `x' OR 1=1 --100%_\\`,
    });
    expect(fragment).toBe(`%attr__data-attr="x\\' OR 1=1 --100\\%\\_\\\\"%`);
  });
});

describe("detail query builders", () => {
  const fragment = '%href="https://us.posthog.com"%';

  it("trend query counts clicks and unique persons per day over 30 days", () => {
    const sql = buildElementTrendQuery("/", fragment);
    expect(sql).toContain("uniq(person_id)");
    expect(sql).toContain("INTERVAL 30 DAY");
    expect(sql).toContain("properties.$pathname = '/'");
    expect(sql).toContain(`elements_chain LIKE '${fragment}'`);
  });

  it("errors query correlates exceptions via shared sessions", () => {
    const sql = buildElementErrorsQuery("/", fragment);
    expect(sql).toContain("'$exception'");
    expect(sql).toContain("$exception_issue_id");
    expect(sql).toContain("`$session_id` IN (");
  });

  it("sessions query lists recent interacting sessions", () => {
    const sql = buildElementSessionsQuery("/", fragment);
    expect(sql).toContain("max(timestamp)");
    expect(sql).toContain("LIMIT 5");
  });

  it("vitals query reads page p75 INP and LCP", () => {
    const sql = buildPageVitalsQuery("/");
    expect(sql).toContain("$web_vitals_INP_value");
    expect(sql).toContain("$web_vitals_LCP_value");
  });

  it("escapes single quotes in pathnames", () => {
    const sql = buildElementTrendQuery("/it's", fragment);
    expect(sql).toContain("properties.$pathname = '/it\\'s'");
  });
});

describe("shapers", () => {
  it("shapes trend rows", () => {
    expect(
      shapeTrendRows([["2026-07-24T00:00:00-07:00", 4226, 2972], ["bad row"]]),
    ).toEqual([
      { day: "2026-07-24T00:00:00-07:00", clicks: 4226, users: 2972 },
    ]);
  });

  it("shapes error rows", () => {
    expect(shapeErrorRows([["019f6b23", '["Error"]', 13066, 970]])).toEqual([
      {
        issueId: "019f6b23",
        types: ["Error"],
        occurrences: 13066,
        affectedUsers: 970,
      },
    ]);
  });

  it("shapes session rows and vitals", () => {
    expect(
      shapeSessionRows([["019fb8ce", "2026-07-31T08:32:29-07:00"]]),
    ).toEqual([
      { sessionId: "019fb8ce", lastSeen: "2026-07-31T08:32:29-07:00" },
    ]);
    expect(shapeVitalsRow([[176.0, 2408.0]])).toEqual({
      inpP75: 176,
      lcpP75: 2408,
    });
    expect(shapeVitalsRow([])).toBeNull();
    expect(shapeVitalsRow([[null, null]])).toBeNull();
  });
});

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
