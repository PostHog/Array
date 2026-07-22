import { describe, expect, it } from "vitest";
import {
  CUSTOMIZABLE_NAV_ITEM_IDS,
  moveNavItem,
  orderedNavItems,
  sanitizeNavItemOrder,
} from "./constants";

describe("CUSTOMIZABLE_NAV_ITEM_IDS", () => {
  it("keeps configuration destinations out of the top-level navigation", () => {
    expect(CUSTOMIZABLE_NAV_ITEM_IDS).not.toEqual(
      expect.arrayContaining(["agents", "skills", "mcp-servers"]),
    );
  });
});

describe("orderedNavItems", () => {
  it("returns the default order for an empty stored order", () => {
    expect(orderedNavItems([]).map((item) => item.id)).toEqual(
      CUSTOMIZABLE_NAV_ITEM_IDS,
    );
  });

  it("inserts an id missing from a full stored order after its default predecessor", () => {
    const withoutLoops = CUSTOMIZABLE_NAV_ITEM_IDS.filter(
      (id) => id !== "loops",
    ).reverse();

    const ids = orderedNavItems(withoutLoops).map((item) => item.id);

    expect(ids.indexOf("loops")).toBe(ids.indexOf("inbox") + 1);
  });

  it("inserts a missing id with no present predecessor at the start", () => {
    const ids = orderedNavItems(["loops", "inbox"]).map((item) => item.id);

    expect(ids[0]).toBe("search");
  });

  it("puts stored ids first and appends the rest in default order", () => {
    const ids = orderedNavItems(["configure", "search"]).map((item) => item.id);

    expect(ids.slice(0, 2)).toEqual(["configure", "search"]);
    expect(ids.slice(2)).toEqual(
      CUSTOMIZABLE_NAV_ITEM_IDS.filter(
        (id) => id !== "configure" && id !== "search",
      ),
    );
  });
});

describe("moveNavItem", () => {
  it("moves an item backward to the target position", () => {
    const next = moveNavItem([], "loops", "search");

    expect(next[0]).toBe("loops");
    expect(next).toHaveLength(CUSTOMIZABLE_NAV_ITEM_IDS.length);
  });

  it("moves an item forward to the target position", () => {
    const next = moveNavItem([], "search", "loops");

    expect(next.indexOf("search")).toBe(
      CUSTOMIZABLE_NAV_ITEM_IDS.indexOf("loops"),
    );
  });

  it.each([
    ["an unknown source", "retired-item", "search"],
    ["an unknown target", "search", "retired-item"],
    ["the same source and target", "search", "search"],
  ])("returns the order unchanged for %s", (_label, source, target) => {
    const order: readonly ("loops" | "search")[] = ["loops", "search"];

    expect(moveNavItem(order, source, target)).toBe(order);
  });
});

describe("sanitizeNavItemOrder", () => {
  it.each([
    ["a string", "corrupt"],
    ["an object", { search: 0 }],
    ["null", null],
    ["a number", 7],
  ])("returns an empty order when the value is %s", (_label, value) => {
    expect(sanitizeNavItemOrder(value)).toEqual([]);
  });

  it("drops unknown ids, non-strings and duplicates", () => {
    expect(
      sanitizeNavItemOrder(["loops", "retired-item", 7, "search", "loops"]),
    ).toEqual(["loops", "search"]);
  });
});
