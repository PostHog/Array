import { describe, expect, it } from "vitest";
import {
  activeTabIsBlank,
  closeTab,
  decideTabNavigation,
  newBlankTab,
  openOrFocusTab,
  POSITION_GAP,
  primaryWindow,
  primaryWindowHasNoTabs,
  reorderTab,
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

describe("reorderTab", () => {
  it("moves a tab to a new index", () => {
    let s = snapshot();
    const a = open(s, "w1", "dash-a");
    const b = open(a.snapshot, "w1", "dash-b");
    const c = open(b.snapshot, "w1", "dash-c");
    s = c.snapshot; // order a,b,c
    const moved = reorderTab(s, c.tabId, 0); // c to front
    const order = moved.tabs
      .slice()
      .sort((x, y) => x.position - y.position)
      .map((t) => t.dashboardId);
    expect(order).toEqual(["dash-c", "dash-a", "dash-b"]);
  });

  it("reindexes when positions would collide", () => {
    const tabs = [
      {
        id: "a",
        windowId: "w1",
        dashboardId: "da",
        taskId: null,
        channelId: null,
        channelSection: null,
        position: 1,
        scrollState: null,
        createdAt: 0,
        lastActiveAt: 0,
      },
      {
        id: "b",
        windowId: "w1",
        dashboardId: "db",
        taskId: null,
        channelId: null,
        channelSection: null,
        position: 2,
        scrollState: null,
        createdAt: 0,
        lastActiveAt: 0,
      },
    ];
    const s = snapshot({ tabs });
    const moved = reorderTab(s, "b", 0);
    const positions = moved.tabs.map((t) => t.position);
    // distinct + spaced after reindex
    expect(new Set(positions).size).toBe(2);
    expect(positions).toContain(POSITION_GAP);
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
