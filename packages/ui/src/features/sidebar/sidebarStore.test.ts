import { beforeEach, describe, expect, it } from "vitest";
import { MORE_NAV_ITEM_IDS } from "./constants";
import { useSidebarStore } from "./sidebarStore";

describe("sidebarStore hiddenNavItems", () => {
  beforeEach(() => {
    useSidebarStore.setState({ hiddenNavItems: [...MORE_NAV_ITEM_IDS] });
  });

  it("hides every moreable item by default", () => {
    expect(useSidebarStore.getState().hiddenNavItems).toEqual([
      "search",
      "skills",
      "mcp-servers",
    ]);
  });

  it.each(MORE_NAV_ITEM_IDS)(
    "setNavItemHidden(%s, false) promotes only that item",
    (item) => {
      useSidebarStore.getState().setNavItemHidden(item, false);

      const hidden = useSidebarStore.getState().hiddenNavItems;
      expect(hidden).not.toContain(item);
      expect(hidden).toHaveLength(MORE_NAV_ITEM_IDS.length - 1);
    },
  );

  it.each(MORE_NAV_ITEM_IDS)(
    "setNavItemHidden(%s, true) is idempotent",
    (item) => {
      useSidebarStore.getState().setNavItemHidden(item, false);
      useSidebarStore.getState().setNavItemHidden(item, true);
      useSidebarStore.getState().setNavItemHidden(item, true);

      const hidden = useSidebarStore.getState().hiddenNavItems;
      expect(hidden.filter((id) => id === item)).toHaveLength(1);
    },
  );

  it.each(MORE_NAV_ITEM_IDS)(
    "promoting %s leaves the other items hidden",
    (item) => {
      useSidebarStore.getState().setNavItemHidden(item, false);

      const hidden = useSidebarStore.getState().hiddenNavItems;
      for (const other of MORE_NAV_ITEM_IDS) {
        if (other !== item) expect(hidden).toContain(other);
      }
    },
  );
});
