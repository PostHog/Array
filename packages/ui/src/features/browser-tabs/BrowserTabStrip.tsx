import { HashIcon } from "@phosphor-icons/react";
import { browserTabsStore } from "@posthog/core/browser-tabs/browserTabsStore";
import { useHostTRPC } from "@posthog/host-router/react";
import { decideTabNavigation, type TabsSnapshot } from "@posthog/shared";
import { channelSectionFor } from "@posthog/ui/features/canvas/channelSections";
import { iconForTemplate } from "@posthog/ui/features/canvas/components/canvasTemplateIcon";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import {
  useDashboard,
  useDashboards,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  useNavigate,
  useParams,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { TabStrip, type TabView } from "./TabStrip";
import { TaskTabIcon } from "./TaskTabIcon";
import { useTabsSnapshot } from "./useBrowserTabs";

/** The active tab id is carried in router history state so back/forward replay
 * tab switches. */
declare module "@tanstack/history" {
  interface HistoryState {
    tabId?: string;
  }
}

/**
 * Module-level caches of display info, keyed by id. Tabs store only references;
 * names are resolved here as the user navigates (which loads each channel's
 * canvases/tasks), so cross-channel tabs still render a real label without
 * loading every channel up front.
 */
const canvasInfo = new Map<string, { name: string; templateId: string }>();
const taskInfo = new Map<string, string>();

/** Bounded insert (most-recent kept) so the caches don't grow unbounded over a
 * long session. */
const MAX_CACHE_ENTRIES = 200;
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_CACHE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function primaryWindow(snapshot: TabsSnapshot) {
  return snapshot.windows.find((w) => w.isPrimary) ?? snapshot.windows[0];
}

type TabRef = {
  id: string;
  dashboardId: string | null;
  taskId: string | null;
  channelId: string | null;
  channelSection: string | null;
};

export function BrowserTabStrip() {
  const snapshot = useTabsSnapshot();
  const navigate = useNavigate();
  const router = useRouter();
  const trpc = useHostTRPC();
  const params = useParams({ strict: false }) as {
    channelId?: string;
    dashboardId?: string;
    taskId?: string;
  };
  const historyTabId = useRouterState({
    select: (s) => s.location.state.tabId,
  });
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { channels } = useChannels();

  // The active channel sub-section (inbox/artifacts/history/context) is the
  // route segment after the channelId. Null when on the channel home or a
  // non-section route (canvas/task), so a channel-home tab labels by name.
  const routeChannelSection = useMemo(() => {
    if (!params.channelId) return null;
    const seg = pathname.split("/")[3] ?? null;
    return channelSectionFor(seg)?.key ?? null;
  }, [pathname, params.channelId]);

  const openOrFocus = useMutation(
    trpc.browserTabs.openOrFocus.mutationOptions(),
  );
  const newBlankTab = useMutation(
    trpc.browserTabs.newBlankTab.mutationOptions(),
  );
  const setTabTarget = useMutation(
    trpc.browserTabs.setTabTarget.mutationOptions(),
  );
  const close = useMutation(trpc.browserTabs.close.mutationOptions());
  const setActiveTab = useMutation(
    trpc.browserTabs.setActiveTab.mutationOptions(),
  );

  const win = primaryWindow(snapshot);
  const windowId = win?.id;
  const activeTab = win?.activeTabId
    ? snapshot.tabs.find((t) => t.id === win.activeTabId)
    : undefined;
  // The history state flips the instant you navigate, while the server snapshot
  // round-trips — so prefer it for "which tab is active" to avoid a one-step lag
  // in the highlight and the name.
  const activeTabId = historyTabId ?? win?.activeTabId ?? null;

  // Names feed the tab labels. The channel canvas list + all-tasks list cover
  // most tabs; a direct fetch of the *current route's* canvas/task (warm cache
  // from the detail page) makes the focused tab's name update the instant you
  // navigate — keyed off the route, not the tab's stored (lagging) target.
  // Only poll the all-tasks list when a task tab actually needs a title.
  const hasTaskTab = snapshot.tabs.some((t) => t.taskId != null);
  const { dashboards } = useDashboards(params.channelId);
  const { dashboard: activeRecord } = useDashboard(params.dashboardId);
  const { data: allTasks } = useTasks(undefined, { enabled: hasTaskTab });
  const { data: activeTaskRecord } = useQuery({
    ...taskDetailQuery(params.taskId ?? ""),
    enabled: !!params.taskId,
  });
  // Remember names so a background tab from another channel keeps its label
  // after its channel's list unloads. Written in an effect (not during render)
  // to keep render pure; the tabs memo reads the live lists first anyway.
  useEffect(() => {
    for (const d of dashboards) {
      remember(canvasInfo, d.id, { name: d.name, templateId: d.templateId });
    }
    if (activeRecord) {
      remember(canvasInfo, activeRecord.id, {
        name: activeRecord.name,
        templateId: activeRecord.templateId,
      });
    }
    for (const t of allTasks ?? []) remember(taskInfo, t.id, t.title);
    if (activeTaskRecord) {
      remember(taskInfo, activeTaskRecord.id, activeTaskRecord.title);
    }
  }, [dashboards, activeRecord, allTasks, activeTaskRecord]);

  // Resolve what the current location means for the strip (see
  // decideTabNavigation) and apply it: focus a tab, replace the active tab's
  // target in place, open a tab, and/or stamp the history entry with the tab it
  // belongs to so back/forward can replay it.
  useEffect(() => {
    if (!windowId) return;
    const stamp = (tabId: string) => {
      const loc = router.history.location;
      // Use the full href (always a string); reconstructing from pathname +
      // search crashes because search is parsed to an object at runtime.
      router.history.replace(loc.href, { ...(loc.state as object), tabId });
    };
    const decision = decideTabNavigation({
      historyTabId: historyTabId ?? null,
      serverActiveTabId: win?.activeTabId ?? null,
      activeTab: activeTab
        ? {
            id: activeTab.id,
            dashboardId: activeTab.dashboardId,
            taskId: activeTab.taskId,
            channelId: activeTab.channelId,
            channelSection: activeTab.channelSection,
          }
        : null,
      routeDashboardId: params.dashboardId ?? null,
      routeTaskId: params.taskId ?? null,
      routeChannelId: params.channelId ?? null,
      routeChannelSection,
    });
    switch (decision.type) {
      case "activate":
        setActiveTab.mutate({ windowId, tabId: decision.tabId });
        break;
      case "replace":
        setTabTarget.mutate({
          tabId: decision.tabId,
          dashboardId: decision.dashboardId,
          taskId: decision.taskId,
          channelId: decision.channelId,
          channelSection: decision.channelSection,
        });
        if (decision.stampTabId) stamp(decision.stampTabId);
        break;
      case "open":
        openOrFocus.mutate({
          windowId,
          dashboardId: decision.dashboardId,
          taskId: decision.taskId,
          channelId: decision.channelId,
          channelSection: decision.channelSection,
        });
        if (decision.stampTabId) stamp(decision.stampTabId);
        break;
      case "stamp":
        stamp(decision.stampTabId);
        break;
    }
  }, [
    windowId,
    historyTabId,
    win?.activeTabId,
    params.channelId,
    params.dashboardId,
    params.taskId,
    routeChannelSection,
    activeTab,
    openOrFocus.mutate,
    setTabTarget.mutate,
    setActiveTab.mutate,
    router,
  ]);

  const channelName = useMemo(() => {
    const map = new Map(channels.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (map.get(id) ?? null) : null);
  }, [channels]);

  const tabs: TabView[] = useMemo(() => {
    if (!windowId) return [];
    // Reference the reactive sources directly so labels recompute the instant a
    // name resolves — not just when the snapshot changes.
    const resolveCanvas = (id: string) => {
      if (activeRecord?.id === id) {
        return { name: activeRecord.name, templateId: activeRecord.templateId };
      }
      const fromList = dashboards.find((d) => d.id === id);
      if (fromList) {
        return { name: fromList.name, templateId: fromList.templateId };
      }
      return canvasInfo.get(id);
    };
    const findTask = (id: string) =>
      activeTaskRecord?.id === id
        ? activeTaskRecord
        : allTasks?.find((t) => t.id === id);

    return snapshot.tabs
      .filter((t) => t.windowId === windowId)
      .sort((a, b) => a.position - b.position)
      .map((t): TabView => {
        // The active tab shows the current route's target, so resolve from the
        // route (instant) rather than its stored ids (which lag a navigation).
        const isActive = t.id === activeTabId;
        const taskId = isActive ? (params.taskId ?? null) : t.taskId;
        const dashId = isActive ? (params.dashboardId ?? null) : t.dashboardId;
        const channelId = isActive ? (params.channelId ?? null) : t.channelId;
        const section = isActive ? routeChannelSection : t.channelSection;
        const channel = channelName(channelId);
        if (taskId) {
          const task = findTask(taskId);
          return {
            id: t.id,
            label: task?.title ?? taskInfo.get(taskId) ?? "Task",
            icon: <TaskTabIcon task={task} size={14} />,
            channelName: channel,
          };
        }
        if (dashId) {
          const info = resolveCanvas(dashId);
          return {
            id: t.id,
            label: info?.name ?? "Canvas",
            icon: iconForTemplate(info?.templateId ?? "freeform", { size: 14 }),
            channelName: channel,
          };
        }
        // A channel tab: a sub-section (Inbox/Artifacts/…) or the channel home.
        // The section drives the label; the channel name carries the `#` hover
        // context. Home has no section, so it labels by the channel name.
        if (channelId) {
          const meta = channelSectionFor(section);
          return {
            id: t.id,
            label: meta?.label ?? channel ?? "Channel",
            icon: <HashIcon size={14} />,
            channelName: channel,
          };
        }
        return { id: t.id, label: "New tab", channelName: null };
      });
  }, [
    snapshot,
    windowId,
    channelName,
    dashboards,
    activeRecord,
    allTasks,
    activeTaskRecord,
    activeTabId,
    params.channelId,
    params.dashboardId,
    params.taskId,
    routeChannelSection,
  ]);

  // Navigate to a tab, tagging the history entry with its id so the switch is
  // replayable by back/forward. A canvas/task tab goes to its route; a blank tab
  // pushes a plain entry (the empty placeholder renders from the active tab).
  const goToTab = (tab: TabRef) => {
    const state = (prev: object) => ({ ...prev, tabId: tab.id });
    if (tab.taskId && tab.channelId) {
      navigate({
        to: "/website/$channelId/tasks/$taskId",
        params: { channelId: tab.channelId, taskId: tab.taskId },
        state,
      });
    } else if (tab.dashboardId && tab.channelId) {
      navigate({
        to: "/website/$channelId/dashboards/$dashboardId",
        params: { channelId: tab.channelId, dashboardId: tab.dashboardId },
        state,
      });
    } else if (tab.channelId) {
      const params = { channelId: tab.channelId };
      switch (tab.channelSection) {
        case "inbox":
          navigate({ to: "/website/$channelId/inbox", params, state });
          break;
        case "artifacts":
          navigate({ to: "/website/$channelId/artifacts", params, state });
          break;
        case "history":
          navigate({ to: "/website/$channelId/history", params, state });
          break;
        case "context":
          navigate({ to: "/website/$channelId/context", params, state });
          break;
        default:
          navigate({ to: "/website/$channelId", params, state });
      }
    } else {
      navigate({ to: "/website", state });
    }
  };

  const handleSelect = (tabId: string) => {
    const tab = snapshot.tabs.find((t) => t.id === tabId);
    if (!tab || !windowId) return;
    // goToTab stamps historyTabId; the navigation effect picks it up and issues
    // setActiveTab via the "activate" path — no need to also fire it here.
    goToTab(tab);
  };

  const handleClose = (tabId: string) => {
    close.mutate(
      { tabId },
      {
        onSuccess: (next) => {
          // Apply the post-close snapshot to the store synchronously before
          // navigating. The store otherwise lags a subscription round-trip, so
          // the /website index would render against the still-has-tabs snapshot
          // and redirect to the first channel (re-opening a tab) before the
          // empty strip arrives.
          browserTabsStore.getState().setSnapshot(next);
          const w = primaryWindow(next);
          const active = w?.activeTabId
            ? next.tabs.find((t) => t.id === w.activeTabId)
            : null;
          if (active) goToTab(active);
          else navigate({ to: "/website" });
        },
      },
    );
  };

  return (
    <TabStrip
      tabs={tabs}
      activeTabId={activeTabId}
      onSelect={handleSelect}
      onClose={handleClose}
      onNewTab={() => {
        if (!windowId) return;
        newBlankTab.mutate(
          { windowId },
          {
            onSuccess: (next) => {
              const w = primaryWindow(next);
              if (w?.activeTabId) {
                goToTab({
                  id: w.activeTabId,
                  dashboardId: null,
                  taskId: null,
                  channelId: null,
                  channelSection: null,
                });
              }
            },
          },
        );
      }}
    />
  );
}
