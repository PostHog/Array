import type { EmbeddedBrowserElement } from "@posthog/platform/embedded-browser";
import { describe, expect, it } from "vitest";
import {
  matchElementStats,
  shapeElementStatsResponse,
} from "./elementMatching";

// Trimmed from a real GET /api/projects/2/elements/stats/ response for
// posthog.com "/" (chains walk innermost → body; clicks often land on an
// inner span while the meaningful anchor is the next link in the chain).
const realStatsResponse = {
  results: [
    {
      count: 32413,
      hash: "10b33e411ad844f8",
      type: "$autocapture",
      elements: [
        {
          text: "Open PostHog",
          tag_name: "span",
          attr_class: ["bg-orange", "flex"],
          href: "https://us.posthog.com",
          attr_id: null,
          nth_child: 1,
          nth_of_type: 1,
          attributes: { attr__class: "flex bg-orange" },
          order: 0,
        },
        {
          text: "Open PostHog",
          tag_name: "a",
          attr_class: ["group"],
          href: null,
          attr_id: null,
          nth_child: null,
          nth_of_type: 1,
          attributes: { attr__href: "https://us.posthog.com" },
          order: 1,
        },
        {
          text: null,
          tag_name: "body",
          attr_class: ["light"],
          href: null,
          attr_id: null,
          nth_child: 2,
          nth_of_type: 1,
          attributes: {},
          order: 11,
        },
      ],
    },
    {
      count: 9020,
      hash: "641f46283dc56fb0",
      type: "$autocapture",
      elements: [
        {
          text: "Get started – free",
          tag_name: "span",
          attr_class: [],
          href: "https://app.posthog.com/signup",
          attr_id: null,
          nth_child: 1,
          nth_of_type: 1,
          attributes: {},
          order: 0,
        },
      ],
    },
    {
      count: 300,
      hash: "ragerow",
      type: "$rageclick",
      elements: [
        {
          text: "Get started – free",
          tag_name: "span",
          attr_class: [],
          href: "https://app.posthog.com/signup",
          attr_id: null,
          nth_child: 1,
          nth_of_type: 1,
          attributes: {},
          order: 0,
        },
      ],
    },
    {
      count: 50,
      hash: "dataattrrow",
      type: "$autocapture",
      elements: [
        {
          text: "Save",
          tag_name: "button",
          attr_class: ["primary"],
          href: null,
          attr_id: null,
          nth_child: 3,
          nth_of_type: 1,
          attributes: { "attr__data-attr": "save-button" },
          order: 0,
        },
      ],
    },
  ],
};

const descriptor = (
  overrides: Partial<EmbeddedBrowserElement>,
): EmbeddedBrowserElement => ({
  selectorHash: "h1",
  tag: "a",
  dataAttr: null,
  id: null,
  classes: [],
  href: null,
  text: null,
  nthChildPath: "",
  ...overrides,
});

describe("shapeElementStatsResponse", () => {
  it("parses rows with count, type, and a normalized chain", () => {
    const rows = shapeElementStatsResponse(realStatsResponse);
    expect(rows).toHaveLength(4);
    expect(rows[0].count).toBe(32413);
    expect(rows[0].type).toBe("$autocapture");
    expect(rows[0].chain[0]).toMatchObject({
      tagName: "span",
      text: "Open PostHog",
      href: "https://us.posthog.com",
    });
    // attr__href on a chain link without a top-level href still surfaces.
    expect(rows[0].chain[1].href).toBe("https://us.posthog.com");
    // data-attr surfaces from the attributes map.
    expect(rows[3].chain[0].dataAttr).toBe("save-button");
  });

  it("returns empty for malformed payloads", () => {
    expect(shapeElementStatsResponse(null)).toEqual([]);
    expect(shapeElementStatsResponse({ results: "nope" })).toEqual([]);
    expect(shapeElementStatsResponse({ results: [{ count: "x" }] })).toEqual(
      [],
    );
  });
});

describe("matchElementStats", () => {
  const rows = shapeElementStatsResponse(realStatsResponse);

  it("matches an anchor by href even when the click landed on an inner span", () => {
    const anchor = descriptor({
      selectorHash: "anchor-us",
      tag: "a",
      href: "https://us.posthog.com",
      text: "Open PostHog",
    });
    const stats = matchElementStats([anchor], rows);
    expect(stats.get("anchor-us")).toMatchObject({
      clicks: 32413,
      rageclicks: 0,
      deadclicks: 0,
    });
  });

  it("prefers data-attr over weaker keys and aggregates rage/dead clicks separately", () => {
    const save = descriptor({
      selectorHash: "save",
      tag: "button",
      dataAttr: "save-button",
      text: "Different label now",
    });
    const signup = descriptor({
      selectorHash: "signup",
      tag: "a",
      href: "https://app.posthog.com/signup",
    });
    const stats = matchElementStats([save, signup], rows);
    expect(stats.get("save")?.clicks).toBe(50);
    expect(stats.get("signup")).toMatchObject({
      clicks: 9020,
      rageclicks: 300,
    });
  });

  it("falls back to tag+text when nothing stronger matches", () => {
    const textOnly = descriptor({
      selectorHash: "text-only",
      tag: "span",
      text: "Get started – free",
    });
    const stats = matchElementStats([textOnly], rows);
    expect(stats.get("text-only")?.clicks).toBe(9020);
  });

  it("leaves unmatched descriptors absent (no false signal)", () => {
    const stranger = descriptor({
      selectorHash: "stranger",
      tag: "button",
      text: "Never clicked",
    });
    const stats = matchElementStats([stranger], rows);
    expect(stats.has("stranger")).toBe(false);
  });
});
