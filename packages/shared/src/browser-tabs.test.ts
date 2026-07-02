import { describe, expect, it } from "vitest";
import {
  activeTabIsBlank,
  closeTab,
  closeTabs,
  decideTabNavigation,
  newBlankTab,
  openOrFocusTab,
  POSITION_GAP,
  primaryWindow,
  primaryWindowHasNoTabs,
  setTabOrder,
  setTabTarget,
} from "./browser-tabs";
import type { TabsSnapshot } from "./browser-tabs-schemas";

let idCounter = 0;
const makeId = () => `tab-${++idCounter}`;
let clock = 0;
const now = () => ++clock;

function snapshot(partial?: Partial<TabsSnapshot>): TabsSnapshot {
  return {
    windows: [{ id: "w1", isPrimary: true, bounds: null, activeTabId: null }],
    tabs: [],
    ...partial,
  };
}

function open(
  s: TabsSnapshot,
  windowId: string,
  dashboardId: string,
  channelId: string | null = "c1",
) {
  return openOrFocusTab(s, {
    windowId,
    dashboardId,
    taskId: null,
    channelId,
    makeId,
    now,
  });
}

describe("openOrFocusTab", () => {
  it("opens a new tab and makes it active", () => {
    const r = open(snapshot(), "w1", "dash-a");
    expect(r.opened).toBe(true);
    expect(r.snapshot.tabs).toHaveLength(1);
    expect(r.snapshot.windows[0].activeTabId).toBe(r.tabId);
    expect(r.snapshot.tabs[0].position).toBe(POSITION_GAP);
  });

  it("dedups within a window: focuses the existing tab instead of opening", () => {
    const first = open(snapshot(), "w1", "dash-a");
    const second = open(first.snapshot, "w1", "dash-a");
    expect(second.opened).toBe(false);
    expect(second.tabId).toBe(first.tabId);
    expect(second.snapshot.tabs).toHaveLength(1);
  });

  it("allows the same canvas in two different windows", () => {
    const twoWindows = snapshot({
      windows: [
        { id: "w1", isPrimary: true, bounds: null, activeTabId: null },
        { id: "w2", isPrimary: false, bounds: null, activeTabId: null },
      ],
    });
    const a = open(twoWindows, "w1", "dash-a");
    const b = open(a.snapshot, "w2", "dash-a");
    expect(b.opened).toBe(true);
    expect(b.snapshot.tabs).toHaveLength(2);
  });

  it("treats a channel's sections as distinct tabs but dedups the same one", () => {
    const inbox = openOrFocusTab(snapshot(), {
      windowId: "w1",
      dashboardId: null,
      taskId: null,
      channelId: "c1",
      channelSection: "inbox",
      makeId,
      now,
    });
    const artifacts = openOrFocusTab(inbox.snapshot, {
      windowId: "w1",
      dashboardId: null,
      taskId: null,
      channelId: "c1",
      channelSection: "artifacts",
      makeId,
      now,
    });
    expect(artifacts.opened).toBe(true);
    expect(artifacts.snapshot.tabs).toHaveLength(2);
    const inboxAgain = openOrFocusTab(artifacts.snapshot, {
      windowId: "w1",
      dashboardId: null,
      taskId: null,
      channelId: "c1",
      channelSection: "inbox",
      makeId,
      now,
    });
    expect(inboxAgain.opened).toBe(false);
    expect(inboxAgain.tabId).toBe(inbox.tabId);
  });

  it("appends new tabs after existing ones", () => {
    const a = open(snapshot(), "w1", "dash-a");
    const b = open(a.snapshot, "w1", "dash-b");
    const positions = b.snapshot.tabs
      .map((t) => t.position)
      .sort((x, y) => x - y);
    expect(positions).toEqual([POSITION_GAP, POSITION_GAP * 2]);
  });
});

describe("closeTab", () => {
  it("focuses the neighbouring tab when the active tab closes", () => {
    let s = snapshot();
    const a = open(s, "w1", "dash-a");
    const b = open(a.snapshot, "w1", "dash-b");
    s = b.snapshot; // active = b
    const r = closeTab(s, b.tabId);
    expect(r.snapshot.tabs).toHaveLength(1);
    expect(r.nextActiveTabId).toBe(a.tabId);
    expect(r.snapshot.windows[0].activeTabId).toBe(a.tabId);
  });

  it("closes a secondary window when its last tab closes", () => {
    const s = snapshot({
      windows: [
        { id: "w1", isPrimary: true, bounds: null, activeTabId: null },
        { id: "w2", isPrimary: false, bounds: null, activeTabId: null },
      ],
    });
    const t = open(s, "w2", "dash-a");
    const r = closeTab(t.snapshot, t.tabId);
    expect(r.closedWindowId).toBe("w2");
    expect(r.snapshot.windows.map((w) => w.id)).toEqual(["w1"]);
  });

  it("shows the landing (null active) when the primary's last tab closes", () => {
    const t = open(snapshot(), "w1", "dash-a");
    const r = closeTab(t.snapshot, t.tabId);
    expect(r.closedWindowId).toBeNull();
    expect(r.snapshot.windows[0].activeTabId).toBeNull();
    expect(r.snapshot.tabs).toHaveLength(0);
  });
});

describe("newBlankTab", () => {
  it("appends a focused blank tab with no canvas", () => {
    const existing = open(snapshot(), "w1", "dash-a");
    const r = newBlankTab(existing.snapshot, { windowId: "w1", makeId, now });
    expect(r.snapshot.tabs).toHaveLength(2);
    const blank = r.snapshot.tabs.find((t) => t.id === r.tabId);
    expect(blank?.dashboardId).toBeNull();
    expect(r.snapshot.windows[0].activeTabId).toBe(r.tabId);
  });
});

describe("setTabTarget", () => {
  it("points an existing tab at a canvas and focuses it (in-tab nav)", () => {
    const blank = newBlankTab(snapshot(), { windowId: "w1", makeId, now });
    const next = setTabTarget(blank.snapshot, {
      tabId: blank.tabId,
      dashboardId: "dash-x",
      taskId: null,
      channelId: "c1",
      now,
    });
    const tab = next.tabs.find((t) => t.id === blank.tabId);
    expect(tab?.dashboardId).toBe("dash-x");
    expect(tab?.channelId).toBe("c1");
    expect(next.tabs).toHaveLength(1); // replaced contents, no new tab
    expect(next.windows[0].activeTabId).toBe(blank.tabId);
  });

  it("points an existing tab at a task (tasks are first-class targets)", () => {
    const blank = newBlankTab(snapshot(), { windowId: "w1", makeId, now });
    const next = setTabTarget(blank.snapshot, {
      tabId: blank.tabId,
      dashboardId: null,
      taskId: "task-9",
      channelId: "c1",
      now,
    });
    const tab = next.tabs.find((t) => t.id === blank.tabId);
    expect(tab?.taskId).toBe("task-9");
    expect(tab?.dashboardId).toBeNull();
  });

  it("is a no-op for an unknown tab id", () => {
    const s = snapshot();
    expect(
      setTabTarget(s, {
        tabId: "nope",
        dashboardId: "d",
        taskId: null,
        channelId: null,
        now,
      }),
    ).toBe(s);
  });
});

describe("decideTabNavigation", () => {
  const base = {
    historyTabId: null as string | null,
    serverActiveTabId: null as string | null,
    activeTab: null as {
      id: string;
      dashboardId: string | null;
      taskId: string | null;
    } | null,
    routeDashboardId: null as string | null,
    routeTaskId: null as string | null,
    routeChannelId: null as string | null,
  };

  it("activates the tagged tab on a switch / back-forward replay", () => {
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-b",
        serverActiveTabId: "tab-a",
      }),
    ).toEqual({ type: "activate", tabId: "tab-b" });
  });

  it("back to the previous tab activates it (history entry tagged with that tab)", () => {
    // After switching A→B, pressing back lands on A's entry: historyTabId=A
    // while the server still thinks B is active → activate A.
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-a",
        serverActiveTabId: "tab-b",
      }),
    ).toEqual({ type: "activate", tabId: "tab-a" });
  });

  it("is a noop when the tagged tab is already active", () => {
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-a",
        serverActiveTabId: "tab-a",
      }),
    ).toEqual({ type: "noop" });
  });

  it("replaces the active tab's canvas on an untagged in-tab nav", () => {
    expect(
      decideTabNavigation({
        ...base,
        serverActiveTabId: "tab-a",
        activeTab: { id: "tab-a", dashboardId: "old", taskId: null },
        routeDashboardId: "new",
        routeChannelId: "c1",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-a",
      dashboardId: "new",
      taskId: null,
      channelId: "c1",
      channelSection: null,
      stampTabId: "tab-a",
    });
  });

  it("replaces even when the entry is tagged with the active tab (inherited tag)", () => {
    // A plain navigate (sidebar) inherits the active tab's tag, so an in-tab nav
    // arrives tagged with the active tab. It must still replace, not noop.
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-a",
        serverActiveTabId: "tab-a",
        activeTab: { id: "tab-a", dashboardId: "old", taskId: null },
        routeDashboardId: "new",
        routeChannelId: "c1",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-a",
      dashboardId: "new",
      taskId: null,
      channelId: "c1",
      channelSection: null,
      stampTabId: "tab-a",
    });
  });

  it("opens a tab when an untagged canvas nav has no active tab", () => {
    expect(
      decideTabNavigation({
        ...base,
        routeDashboardId: "d1",
        routeChannelId: "c1",
      }),
    ).toEqual({
      type: "open",
      dashboardId: "d1",
      taskId: null,
      channelId: "c1",
      channelSection: null,
      stampTabId: null,
    });
  });

  it("replaces the active tab when navigating between channel sections", () => {
    // In-tab nav from a channel's inbox to its artifacts: same tab, new section.
    expect(
      decideTabNavigation({
        ...base,
        serverActiveTabId: "tab-a",
        activeTab: {
          id: "tab-a",
          dashboardId: null,
          taskId: null,
          channelId: "c1",
          channelSection: "inbox",
        },
        routeChannelId: "c1",
        routeChannelSection: "artifacts",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-a",
      dashboardId: null,
      taskId: null,
      channelId: "c1",
      channelSection: "artifacts",
      stampTabId: "tab-a",
    });
  });

  it("opens a channel-section tab when there is no active tab", () => {
    expect(
      decideTabNavigation({
        ...base,
        routeChannelId: "c1",
        routeChannelSection: "inbox",
      }),
    ).toEqual({
      type: "open",
      dashboardId: null,
      taskId: null,
      channelId: "c1",
      channelSection: "inbox",
      stampTabId: null,
    });
  });

  it("only stamps when the active tab already shows the route channel section", () => {
    expect(
      decideTabNavigation({
        ...base,
        serverActiveTabId: "tab-a",
        activeTab: {
          id: "tab-a",
          dashboardId: null,
          taskId: null,
          channelId: "c1",
          channelSection: "inbox",
        },
        routeChannelId: "c1",
        routeChannelSection: "inbox",
      }),
    ).toEqual({ type: "stamp", stampTabId: "tab-a" });
  });

  it("only stamps when the active tab already shows the route canvas", () => {
    expect(
      decideTabNavigation({
        ...base,
        serverActiveTabId: "tab-a",
        activeTab: { id: "tab-a", dashboardId: "same", taskId: null },
        routeDashboardId: "same",
      }),
    ).toEqual({ type: "stamp", stampTabId: "tab-a" });
  });

  it("is a noop on a blank/landing route (no canvas)", () => {
    expect(
      decideTabNavigation({
        ...base,
        serverActiveTabId: "tab-a",
        activeTab: { id: "tab-a", dashboardId: null, taskId: null },
        routeDashboardId: null,
      }),
    ).toEqual({ type: "noop" });
  });
});

function openChannel(s: TabsSnapshot, windowId: string, channelId: string) {
  return openOrFocusTab(s, {
    windowId,
    dashboardId: null,
    taskId: null,
    channelId,
    makeId,
    now,
  });
}

describe("activeTabIsBlank", () => {
  it("is true when the active tab has no canvas, task, or channel", () => {
    const t = newBlankTab(snapshot(), { windowId: "w1", makeId, now });
    expect(activeTabIsBlank(t.snapshot)).toBe(true);
  });

  it("is false when the active tab points at a canvas", () => {
    const t = open(snapshot(), "w1", "dash-a");
    expect(activeTabIsBlank(t.snapshot)).toBe(false);
  });

  it("is false when the active tab is a channel tab (channel home)", () => {
    const t = openChannel(snapshot(), "w1", "c1");
    expect(activeTabIsBlank(t.snapshot)).toBe(false);
  });

  it("is false when there is no active tab", () => {
    expect(activeTabIsBlank(snapshot())).toBe(false);
  });
});

describe("primaryWindowHasNoTabs", () => {
  it("is true when the primary window's last tab was closed", () => {
    const opened = open(snapshot(), "w1", "dash-a");
    const closed = closeTab(opened.snapshot, opened.tabId);
    expect(primaryWindowHasNoTabs(closed.snapshot)).toBe(true);
  });

  it("is false while the primary window still has a tab", () => {
    const t = open(snapshot(), "w1", "dash-a");
    expect(primaryWindowHasNoTabs(t.snapshot)).toBe(false);
  });

  it("ignores tabs that belong to other windows", () => {
    const s = snapshot({
      windows: [
        { id: "w1", isPrimary: true, bounds: null, activeTabId: null },
        { id: "w2", isPrimary: false, bounds: null, activeTabId: null },
      ],
    });
    const onlyInSecondary = open(s, "w2", "dash-a");
    expect(primaryWindowHasNoTabs(onlyInSecondary.snapshot)).toBe(true);
  });
});

describe("closeTabs", () => {
  /** Open n dashboards in w1, returning the snapshot and ordered tab ids. */
  function openMany(n: number) {
    let s = snapshot();
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = open(s, "w1", `dash-${i}`);
      s = r.snapshot;
      ids.push(r.tabId);
    }
    return { s, ids };
  }

  it("is a noop for an empty or unknown id list", () => {
    const { s } = openMany(2);
    expect(closeTabs(s, [])).toBe(s);
    expect(closeTabs(s, ["nope"]).tabs).toHaveLength(2);
  });

  it("removes the given tabs and keeps the rest", () => {
    const { s, ids } = openMany(4);
    const r = closeTabs(s, [ids[1], ids[2]]);
    expect(r.tabs.map((t) => t.id)).toEqual([ids[0], ids[3]]);
    expect(r.windows).toHaveLength(1);
  });

  it("keeps the active tab focused when it survives", () => {
    const { s, ids } = openMany(3);
    const focused = closeTabs(setFocus(s, ids[0]), [ids[1], ids[2]]);
    expect(focused.windows[0].activeTabId).toBe(ids[0]);
  });

  it("focuses the anchor when the active tab is closed", () => {
    const { s, ids } = openMany(4);
    // Active is ids[1]; "close others" on anchor ids[0] closes 1,2,3 → the
    // anchor takes focus even though a stored-order neighbour differs.
    const r = closeTabs(setFocus(s, ids[1]), [ids[1], ids[2], ids[3]], ids[0]);
    expect(r.windows[0].activeTabId).toBe(ids[0]);
  });

  it("falls back to closeTab's neighbour when no anchor is given", () => {
    const { s, ids } = openMany(4);
    // Active ids[1]; closing 1,2 leaves [0,3]; the survivor at the old slot is 3.
    const r = closeTabs(setFocus(s, ids[1]), [ids[1], ids[2]]);
    expect(r.windows[0].activeTabId).toBe(ids[3]);
  });

  it("ignores an anchor when the active tab survived", () => {
    const { s, ids } = openMany(4);
    // Active ids[0] survives; anchor must not steal focus from it.
    const r = closeTabs(setFocus(s, ids[0]), [ids[2], ids[3]], ids[1]);
    expect(r.windows[0].activeTabId).toBe(ids[0]);
  });

  it("lands the primary window on channels when all tabs close", () => {
    const { s, ids } = openMany(2);
    const r = closeTabs(s, ids);
    expect(r.tabs).toHaveLength(0);
    expect(r.windows[0].activeTabId).toBeNull();
  });

  it("drops an emptied secondary window", () => {
    const base = snapshot({
      windows: [
        { id: "w1", isPrimary: true, bounds: null, activeTabId: null },
        { id: "w2", isPrimary: false, bounds: null, activeTabId: null },
      ],
    });
    const a = open(base, "w2", "dash-a");
    const b = open(a.snapshot, "w2", "dash-b");
    const r = closeTabs(b.snapshot, [a.tabId, b.tabId]);
    expect(r.windows.map((w) => w.id)).toEqual(["w1"]);
  });

  function setFocus(s: TabsSnapshot, tabId: string): TabsSnapshot {
    return {
      ...s,
      windows: s.windows.map((w) =>
        w.id === "w1" ? { ...w, activeTabId: tabId } : w,
      ),
    };
  }
});

describe("setTabOrder", () => {
  function openThree() {
    let s = snapshot();
    const ids: string[] = [];
    for (const d of ["a", "b", "c"]) {
      const r = open(s, "w1", `dash-${d}`);
      s = r.snapshot;
      ids.push(r.tabId);
    }
    return { s, ids };
  }

  function orderOf(s: TabsSnapshot): string[] {
    return s.tabs
      .filter((t) => t.windowId === "w1")
      .sort((a, b) => a.position - b.position)
      .map((t) => t.id);
  }

  it("persists the given order with clean gap positions", () => {
    const { s, ids } = openThree();
    const next = setTabOrder(s, "w1", [ids[2], ids[0], ids[1]]);
    expect(orderOf(next)).toEqual([ids[2], ids[0], ids[1]]);
    expect(
      next.tabs
        .filter((t) => t.windowId === "w1")
        .sort((a, b) => a.position - b.position)
        .map((t) => t.position),
    ).toEqual([POSITION_GAP, 2 * POSITION_GAP, 3 * POSITION_GAP]);
  });

  it("ignores unknown ids and appends unlisted tabs in old order", () => {
    const { s, ids } = openThree();
    const next = setTabOrder(s, "w1", ["nope", ids[1]]);
    expect(orderOf(next)).toEqual([ids[1], ids[0], ids[2]]);
  });

  it("leaves other windows' tabs untouched", () => {
    const base = snapshot({
      windows: [
        { id: "w1", isPrimary: true, bounds: null, activeTabId: null },
        { id: "w2", isPrimary: false, bounds: null, activeTabId: null },
      ],
    });
    const other = open(base, "w2", "dash-z");
    const r = open(other.snapshot, "w1", "dash-a");
    const next = setTabOrder(r.snapshot, "w1", [r.tabId]);
    const w2tab = next.tabs.find((t) => t.windowId === "w2");
    expect(w2tab?.position).toBe(POSITION_GAP);
  });
});

describe("primaryWindow", () => {
  it("prefers the primary window, falling back to the first", () => {
    const s = snapshot({
      windows: [
        { id: "w2", isPrimary: false, bounds: null, activeTabId: null },
        { id: "w1", isPrimary: true, bounds: null, activeTabId: null },
      ],
    });
    expect(primaryWindow(s)?.id).toBe("w1");
  });
});
