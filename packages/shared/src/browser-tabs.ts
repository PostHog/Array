import type { BrowserTab, TabsSnapshot } from "./browser-tabs-schemas";

/** Spacing between adjacent tab positions, leaving room to insert without reindex. */
export const POSITION_GAP = 1000;

type Clock = () => number;
type IdFactory = () => string;

export type OpenTabResult = {
  snapshot: TabsSnapshot;
  tabId: string;
  /** False when an existing tab was focused (dedup) rather than created. */
  opened: boolean;
};

export type CloseTabResult = {
  snapshot: TabsSnapshot;
  /** Tab focused after the close, or null for the channels landing. */
  nextActiveTabId: string | null;
  /** Set when closing the last tab of a secondary window should close it. */
  closedWindowId: string | null;
};

function tabsInWindow(snapshot: TabsSnapshot, windowId: string): BrowserTab[] {
  return snapshot.tabs
    .filter((t) => t.windowId === windowId)
    .sort((a, b) => a.position - b.position);
}

/** The primary window, falling back to the first one (web has a single window). */
export function primaryWindow(snapshot: TabsSnapshot) {
  return snapshot.windows.find((w) => w.isPrimary) ?? snapshot.windows[0];
}

/**
 * True when the primary window's active tab is a blank "+" tab: no canvas,
 * task, or channel. The blank tab parks at the channels index (`/website`),
 * whose route would otherwise redirect to the first channel — callers use this
 * to suppress that redirect so the blank tab (and the in-flight navigation
 * leaving it) isn't hijacked to `channels[0]`.
 */
export function activeTabIsBlank(snapshot: TabsSnapshot): boolean {
  const w = primaryWindow(snapshot);
  if (!w?.activeTabId) return false;
  const t = snapshot.tabs.find((x) => x.id === w.activeTabId);
  return (
    !!t && t.dashboardId == null && t.taskId == null && t.channelId == null
  );
}

/**
 * True when the primary window has no tabs at all — the user closed every tab.
 * The channels index renders the new-tab screen for this state rather than
 * redirecting to the first channel, which would silently re-open a tab.
 */
export function primaryWindowHasNoTabs(snapshot: TabsSnapshot): boolean {
  const w = primaryWindow(snapshot);
  if (!w) return false;
  return !snapshot.tabs.some((t) => t.windowId === w.id);
}

function setActiveTab(
  snapshot: TabsSnapshot,
  windowId: string,
  tabId: string | null,
): TabsSnapshot {
  return {
    ...snapshot,
    windows: snapshot.windows.map((w) =>
      w.id === windowId ? { ...w, activeTabId: tabId } : w,
    ),
  };
}

/** What a tab points at: a canvas, a task, or neither (blank). */
export type TabTarget = {
  dashboardId: string | null;
  taskId: string | null;
};

/**
 * Everything that identifies a tab's contents: a canvas, a task, or a channel
 * sub-section (channel + section). Two tabs with the same identity are the same
 * page, so dedup and in-tab-nav comparisons key on all four — a channel's
 * `inbox` and `artifacts`, or two channels' inboxes, are distinct pages.
 */
export type TabIdentity = {
  dashboardId: string | null;
  taskId: string | null;
  channelId: string | null;
  channelSection: string | null;
};

function sameIdentity(a: TabIdentity, b: TabIdentity): boolean {
  return (
    a.dashboardId === b.dashboardId &&
    a.taskId === b.taskId &&
    a.channelId === b.channelId &&
    a.channelSection === b.channelSection
  );
}

/**
 * Open a target (canvas or task) in a window, deduping within that window: if a
 * tab for the same target already exists in the window it is focused, otherwise
 * a new tab is appended. Duplicates across different windows are allowed.
 */
export function openOrFocusTab(
  snapshot: TabsSnapshot,
  input: TabTarget & {
    windowId: string;
    channelId: string | null;
    channelSection?: string | null;
    makeId: IdFactory;
    now: Clock;
  },
): OpenTabResult {
  const { windowId, dashboardId, taskId, channelId, makeId, now } = input;
  const channelSection = input.channelSection ?? null;
  const existing = snapshot.tabs.find(
    (t) =>
      t.windowId === windowId &&
      sameIdentity(t, { dashboardId, taskId, channelId, channelSection }),
  );
  if (existing) {
    const ts = now();
    const withActivity: TabsSnapshot = {
      ...snapshot,
      tabs: snapshot.tabs.map((t) =>
        t.id === existing.id ? { ...t, lastActiveAt: ts } : t,
      ),
    };
    return {
      snapshot: setActiveTab(withActivity, windowId, existing.id),
      tabId: existing.id,
      opened: false,
    };
  }

  return appendTab(snapshot, {
    windowId,
    dashboardId,
    taskId,
    channelId,
    channelSection,
    makeId,
    now,
  });
}

function appendTab(
  snapshot: TabsSnapshot,
  input: TabTarget & {
    windowId: string;
    channelId: string | null;
    channelSection?: string | null;
    makeId: IdFactory;
    now: Clock;
  },
): OpenTabResult {
  const { windowId, dashboardId, taskId, channelId, makeId, now } = input;
  const siblings = tabsInWindow(snapshot, windowId);
  const lastPos = siblings.length ? siblings[siblings.length - 1].position : 0;
  const ts = now();
  const tab: BrowserTab = {
    id: makeId(),
    windowId,
    dashboardId,
    taskId,
    channelId,
    channelSection: input.channelSection ?? null,
    position: lastPos + POSITION_GAP,
    scrollState: null,
    createdAt: ts,
    lastActiveAt: ts,
  };
  const withTab: TabsSnapshot = { ...snapshot, tabs: [...snapshot.tabs, tab] };
  return {
    snapshot: setActiveTab(withTab, windowId, tab.id),
    tabId: tab.id,
    opened: true,
  };
}

/**
 * Append a blank tab (no target) and focus it. The strip shows it as an empty
 * placeholder; navigating while it is active replaces its contents via
 * {@link setTabTarget}.
 */
export function newBlankTab(
  snapshot: TabsSnapshot,
  input: { windowId: string; makeId: IdFactory; now: Clock },
): OpenTabResult {
  return appendTab(snapshot, {
    windowId: input.windowId,
    dashboardId: null,
    taskId: null,
    channelId: null,
    makeId: input.makeId,
    now: input.now,
  });
}

/**
 * Point an existing tab at a target (canvas or task) — the in-tab navigation
 * primitive. Used when the user navigates while a tab is active, so the target
 * replaces the tab's contents instead of opening a new tab. Also focuses it.
 */
export function setTabTarget(
  snapshot: TabsSnapshot,
  input: TabTarget & {
    tabId: string;
    channelId: string | null;
    channelSection?: string | null;
    now: Clock;
  },
): TabsSnapshot {
  const tab = snapshot.tabs.find((t) => t.id === input.tabId);
  if (!tab) return snapshot;
  const ts = input.now();
  const withTarget: TabsSnapshot = {
    ...snapshot,
    tabs: snapshot.tabs.map((t) =>
      t.id === input.tabId
        ? {
            ...t,
            dashboardId: input.dashboardId,
            taskId: input.taskId,
            channelId: input.channelId,
            channelSection: input.channelSection ?? null,
            lastActiveAt: ts,
          }
        : t,
    ),
  };
  return setActiveTab(withTarget, tab.windowId, input.tabId);
}

/**
 * Close a tab. Focus moves to the nearest sibling. Closing the last tab of a
 * secondary window signals that the window should close; closing the last tab
 * of the primary window leaves it on the channels landing (activeTabId null).
 */
export function closeTab(
  snapshot: TabsSnapshot,
  tabId: string,
): CloseTabResult {
  const tab = snapshot.tabs.find((t) => t.id === tabId);
  if (!tab) {
    return { snapshot, nextActiveTabId: null, closedWindowId: null };
  }
  const window = snapshot.windows.find((w) => w.id === tab.windowId);
  const siblings = tabsInWindow(snapshot, tab.windowId);
  const idx = siblings.findIndex((t) => t.id === tabId);
  const remaining = siblings.filter((t) => t.id !== tabId);

  const removedTabs = snapshot.tabs.filter((t) => t.id !== tabId);

  if (remaining.length === 0) {
    if (window && !window.isPrimary) {
      // Drop the window too.
      return {
        snapshot: {
          windows: snapshot.windows.filter((w) => w.id !== tab.windowId),
          tabs: removedTabs,
        },
        nextActiveTabId: null,
        closedWindowId: tab.windowId,
      };
    }
    // Primary window → channels landing.
    return {
      snapshot: setActiveTab(
        { ...snapshot, tabs: removedTabs },
        tab.windowId,
        null,
      ),
      nextActiveTabId: null,
      closedWindowId: null,
    };
  }

  // Focus the tab that took the closed slot, else the new last one.
  const next = remaining[Math.min(idx, remaining.length - 1)];
  const wasActive = window?.activeTabId === tabId;
  const base: TabsSnapshot = { ...snapshot, tabs: removedTabs };
  return {
    snapshot: wasActive ? setActiveTab(base, tab.windowId, next.id) : base,
    nextActiveTabId: wasActive ? next.id : (window?.activeTabId ?? null),
    closedWindowId: null,
  };
}

/**
 * Move a tab to a target index within its window's strip, recomputing its
 * position. Falls back to a full reindex when gap-spacing collapses.
 */
export function reorderTab(
  snapshot: TabsSnapshot,
  tabId: string,
  toIndex: number,
): TabsSnapshot {
  const tab = snapshot.tabs.find((t) => t.id === tabId);
  if (!tab) return snapshot;
  const ordered = tabsInWindow(snapshot, tab.windowId).filter(
    (t) => t.id !== tabId,
  );
  const clamped = Math.max(0, Math.min(toIndex, ordered.length));
  const next = [...ordered];
  next.splice(clamped, 0, tab);

  // Renormalise to clean gap-spacing every move: deterministic positions, no
  // unbounded drift or fractional collapse. Cheap for a tab strip.
  const reindexed = next.map((t, i) => ({
    ...t,
    position: (i + 1) * POSITION_GAP,
  }));
  const byId = new Map(reindexed.map((t) => [t.id, t]));
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((t) => byId.get(t.id) ?? t),
  };
}

// ----- Navigation intent (drives the renderer effect) -----

/**
 * What a navigation means for the tab strip, given the router state. This is the
 * decision the renderer makes on every location change; extracted as a pure
 * function so the UX rules are testable without a router.
 *
 * - `activate`: the entry is tagged with a tab (a tab switch, or a back/forward
 *   replay landing on a tab) → focus that tab.
 * - `replace`: an untagged navigation to a target (canvas or task) while a tab
 *   is active → swap the active tab's target in place (in-tab navigation), and
 *   stamp the entry.
 * - `open`: an untagged navigation to a target with no active tab → open one.
 * - `stamp`: an untagged navigation whose target already matches the active tab
 *   → nothing to change, just tag the entry so back/forward can replay it.
 * - `noop`: nothing to do (already on the right tab, or a blank/landing route).
 */
export type TabNavDecision =
  | { type: "activate"; tabId: string }
  | {
      type: "replace";
      tabId: string;
      dashboardId: string | null;
      taskId: string | null;
      channelId: string | null;
      channelSection: string | null;
      stampTabId: string | null;
    }
  | {
      type: "open";
      dashboardId: string | null;
      taskId: string | null;
      channelId: string | null;
      channelSection: string | null;
      stampTabId: string | null;
    }
  | { type: "stamp"; stampTabId: string }
  | { type: "noop" };

export function decideTabNavigation(input: {
  /** tabId carried in the current history entry, if any. */
  historyTabId: string | null;
  /** The window's active tab id from the server snapshot (lags history). */
  serverActiveTabId: string | null;
  /** The active tab record, if one exists. */
  activeTab: {
    id: string;
    dashboardId: string | null;
    taskId: string | null;
    channelId?: string | null;
    channelSection?: string | null;
  } | null;
  /** Canvas in the current route, if any. */
  routeDashboardId: string | null;
  /** Task in the current route, if any. */
  routeTaskId: string | null;
  routeChannelId: string | null;
  /** Channel sub-section in the current route, if any. */
  routeChannelSection?: string | null;
}): TabNavDecision {
  const {
    historyTabId,
    serverActiveTabId,
    activeTab,
    routeDashboardId,
    routeTaskId,
    routeChannelId,
  } = input;
  const routeChannelSection = input.routeChannelSection ?? null;

  // Tagged entry for a DIFFERENT tab → a tab switch or a back/forward replay.
  // Focus it (this is how "back returns to the previous tab" resolves). When
  // the tag equals the active tab we must NOT stop here: a plain navigation
  // (e.g. the sidebar) inherits the active tab's tag, so an in-tab nav arrives
  // tagged with the active tab — fall through and decide from the route.
  if (historyTabId && historyTabId !== serverActiveTabId) {
    return { type: "activate", tabId: historyTabId };
  }

  // Navigation within the active tab. A real target is a canvas, a task, or a
  // channel (home or sub-section); the landing/blank route (no channel) is a
  // noop.
  const routeIdentity: TabIdentity = {
    dashboardId: routeDashboardId,
    taskId: routeTaskId,
    channelId: routeChannelId,
    channelSection: routeChannelSection,
  };
  if (!routeDashboardId && !routeTaskId && !routeChannelId) {
    return { type: "noop" };
  }

  if (
    activeTab &&
    !sameIdentity(
      {
        dashboardId: activeTab.dashboardId,
        taskId: activeTab.taskId,
        channelId: activeTab.channelId ?? null,
        channelSection: activeTab.channelSection ?? null,
      },
      routeIdentity,
    )
  ) {
    return {
      type: "replace",
      tabId: activeTab.id,
      dashboardId: routeDashboardId,
      taskId: routeTaskId,
      channelId: routeChannelId,
      channelSection: routeChannelSection,
      stampTabId: serverActiveTabId,
    };
  }
  if (!activeTab) {
    return {
      type: "open",
      dashboardId: routeDashboardId,
      taskId: routeTaskId,
      channelId: routeChannelId,
      channelSection: routeChannelSection,
      stampTabId: serverActiveTabId,
    };
  }
  // Active tab already shows this target — just tag the entry.
  return serverActiveTabId
    ? { type: "stamp", stampTabId: serverActiveTabId }
    : { type: "noop" };
}
