import { describe, expect, it } from "vitest";
import { buildOverlayItems, healthFor } from "./healthScore";

describe("healthFor", () => {
  it.each([
    // clicks, rageclicks, deadclicks → health
    { clicks: 1000, rageclicks: 0, deadclicks: 0, expected: "green" },
    { clicks: 1000, rageclicks: 15, deadclicks: 0, expected: "amber" }, // 1.5%
    { clicks: 1000, rageclicks: 40, deadclicks: 20, expected: "red" }, // 6%
    { clicks: 1000, rageclicks: 0, deadclicks: 60, expected: "red" },
    // Tiny samples never alarm: 1 rage click out of 10 is noise, not signal.
    { clicks: 10, rageclicks: 1, deadclicks: 0, expected: "green" },
    { clicks: 0, rageclicks: 0, deadclicks: 0, expected: "green" },
  ])(
    "clicks=$clicks rage=$rageclicks dead=$deadclicks → $expected",
    ({ clicks, rageclicks, deadclicks, expected }) => {
      expect(healthFor({ clicks, rageclicks, deadclicks })).toBe(expected);
    },
  );
});

describe("buildOverlayItems", () => {
  const stats = new Map([
    ["a", { clicks: 50000, rageclicks: 0, deadclicks: 0 }],
    ["b", { clicks: 900, rageclicks: 90, deadclicks: 0 }], // red
    ["c", { clicks: 30, rageclicks: 0, deadclicks: 0 }],
    ["d", { clicks: 20000, rageclicks: 250, deadclicks: 50 }], // amber
  ]);

  it("always includes unhealthy elements and ranks the rest by usage", () => {
    const items = buildOverlayItems(stats, { maxItems: 3 });
    const byHash = new Map(items.map((i) => [i.selectorHash, i]));
    // Unhealthy first regardless of volume.
    expect(byHash.get("b")?.halo).toBe("red");
    expect(byHash.get("d")?.halo).toBe("amber");
    // Remaining slot goes to the top-usage healthy element.
    expect(byHash.get("a")?.halo).toBe("green");
    expect(byHash.has("c")).toBe(false);
    expect(items).toHaveLength(3);
  });

  it("labels items with compact usage and frustration share", () => {
    const items = buildOverlayItems(stats, { maxItems: 4 });
    const byHash = new Map(items.map((i) => [i.selectorHash, i]));
    expect(byHash.get("a")?.label).toBe("50K clicks");
    // 90 rage of 990 total interactions → 9%.
    expect(byHash.get("b")?.label).toBe("900 clicks · 9% frustrated");
  });
});
