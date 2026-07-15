import { beforeEach, describe, expect, it } from "vitest";
import { CUSTOMIZABLE_NAV_ITEMS, isNavItemVisible } from "./constants";
import { useSidebarStore } from "./sidebarStore";

describe("sidebarStore navItemOverrides", () => {
  beforeEach(() => {
    useSidebarStore.setState({ navItemOverrides: {} });
  });

  it.each(
    CUSTOMIZABLE_NAV_ITEMS.map(
      (item) => [item.id, item.defaultVisible] as const,
    ),
  )("%s is visible=%s by default", (id, defaultVisible) => {
    const overrides = useSidebarStore.getState().navItemOverrides;
    expect(isNavItemVisible(overrides, id)).toBe(defaultVisible);
  });

  it.each(CUSTOMIZABLE_NAV_ITEMS.map((item) => item.id))(
    "setNavItemVisible(%s) overrides in both directions",
    (id) => {
      useSidebarStore.getState().setNavItemVisible(id, true);
      expect(
        isNavItemVisible(useSidebarStore.getState().navItemOverrides, id),
      ).toBe(true);

      useSidebarStore.getState().setNavItemVisible(id, false);
      expect(
        isNavItemVisible(useSidebarStore.getState().navItemOverrides, id),
      ).toBe(false);
    },
  );

  it("overriding one item leaves the others at their defaults", () => {
    useSidebarStore.getState().setNavItemVisible("agents", false);

    const overrides = useSidebarStore.getState().navItemOverrides;
    for (const item of CUSTOMIZABLE_NAV_ITEMS) {
      if (item.id === "agents") continue;
      expect(isNavItemVisible(overrides, item.id)).toBe(item.defaultVisible);
    }
  });

  it.each([
    ["a string", "corrupt"],
    ["an array", ["search"]],
    ["null", null],
    ["a number", 7],
  ])(
    "rehydration falls back to defaults when persisted overrides are %s",
    async (_label, corrupt) => {
      localStorage.setItem(
        "sidebar-storage",
        JSON.stringify({ state: { navItemOverrides: corrupt }, version: 0 }),
      );

      await useSidebarStore.persist.rehydrate();

      expect(useSidebarStore.getState().navItemOverrides).toEqual({});
      localStorage.removeItem("sidebar-storage");
    },
  );

  it("rehydration falls back to defaults when persisted state predates overrides", async () => {
    localStorage.setItem(
      "sidebar-storage",
      JSON.stringify({ state: { open: true }, version: 0 }),
    );

    await useSidebarStore.persist.rehydrate();

    expect(useSidebarStore.getState().navItemOverrides).toEqual({});
    localStorage.removeItem("sidebar-storage");
  });

  it("rehydration drops unknown ids and non-boolean values", async () => {
    localStorage.setItem(
      "sidebar-storage",
      JSON.stringify({
        state: {
          navItemOverrides: {
            search: true,
            "retired-item": true,
            skills: "yes",
          },
        },
        version: 0,
      }),
    );

    await useSidebarStore.persist.rehydrate();

    expect(useSidebarStore.getState().navItemOverrides).toEqual({
      search: true,
    });
    localStorage.removeItem("sidebar-storage");
  });
});
