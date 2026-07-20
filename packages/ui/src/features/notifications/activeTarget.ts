import type { NotificationTarget } from "@posthog/platform/notifications";
import { ACTIVITY_THREAD_KEY } from "@posthog/ui/features/canvas/stores/threadPanelStore";

/** The open thread panel, as much of it as deciding "am I looking at this?" needs. */
export interface ThreadPanelSnapshot {
  /** Surface key → the task whose thread is open there. */
  openByChannel: Record<string, string | null>;
  /** Collapsed to a rail: the thread is no longer on screen. */
  collapsed: boolean;
}

/**
 * What the viewer is looking at, for deciding whether a notification about it
 * would be telling them something they can already see.
 *
 * The route alone isn't the answer. A task's thread opens *beside* the channel
 * feed and the Activity list without changing the route, so keying off the
 * route would announce "needs your input" for a task filling half the screen.
 * The open thread panel is as much "viewing the task" as its own route is.
 */
export function activeNotificationTarget({
  routeId,
  params,
  threadPanel,
}: {
  routeId: string | undefined;
  params: Record<string, string | undefined>;
  threadPanel: ThreadPanelSnapshot;
}): NotificationTarget | undefined {
  // A collapsed panel is a rail with nothing legible in it, so it isn't viewing.
  const openThreadTaskId = (key: string | undefined): string | undefined =>
    !key || threadPanel.collapsed
      ? undefined
      : (threadPanel.openByChannel[key] ?? undefined);

  switch (routeId) {
    case "/code/tasks/$taskId":
    case "/website/$channelId/tasks/$taskId":
      return params.taskId
        ? { kind: "task", taskId: params.taskId }
        : undefined;

    case "/website/$channelId/dashboards/$dashboardId":
      return params.channelId && params.dashboardId
        ? {
            kind: "canvas",
            channelId: params.channelId,
            dashboardId: params.dashboardId,
          }
        : undefined;

    // The channel feed and the Activity list both host a thread beside them.
    case "/website/$channelId": {
      const taskId = openThreadTaskId(params.channelId);
      return taskId ? { kind: "task", taskId } : undefined;
    }
    case "/website/activity": {
      const taskId = openThreadTaskId(ACTIVITY_THREAD_KEY);
      return taskId ? { kind: "task", taskId } : undefined;
    }

    default:
      return undefined;
  }
}
