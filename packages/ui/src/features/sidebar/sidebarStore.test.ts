import { beforeEach, describe, expect, it } from "vitest";
import { MORE_NAV_ITEM_IDS } from "./constants";
import { useSidebarStore } from "./sidebarStore";

describe("sidebarStore promotedNavItems", () => {
  beforeEach(() => {
    useSidebarStore.setState({ promotedNavItems: [] });
  });

  it("keeps every moreable item under More by default", () => {
    expect(useSidebarStore.getState().promotedNavItems).toEqual([]);
    expect(MORE_NAV_ITEM_IDS).toEqual([
      "search",
      "skills",
      "mcp-servers",
      "usage",
    ]);
  });

  it.each(MORE_NAV_ITEM_IDS)(
    "setNavItemVisible(%s, true) promotes only that item",
    (item) => {
      useSidebarStore.getState().setNavItemVisible(item, true);

      expect(useSidebarStore.getState().promotedNavItems).toEqual([item]);
    },
  );

  it.each(MORE_NAV_ITEM_IDS)(
    "setNavItemVisible(%s, true) is idempotent",
    (item) => {
      useSidebarStore.getState().setNavItemVisible(item, true);
      useSidebarStore.getState().setNavItemVisible(item, true);

      expect(useSidebarStore.getState().promotedNavItems).toEqual([item]);
    },
  );

  it.each(MORE_NAV_ITEM_IDS)(
    "setNavItemVisible(%s, false) demotes only that item",
    (item) => {
      for (const id of MORE_NAV_ITEM_IDS) {
        useSidebarStore.getState().setNavItemVisible(id, true);
      }

      useSidebarStore.getState().setNavItemVisible(item, false);

      const promoted = useSidebarStore.getState().promotedNavItems;
      expect(promoted).not.toContain(item);
      expect(promoted).toHaveLength(MORE_NAV_ITEM_IDS.length - 1);
    },
  );
});
