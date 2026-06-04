import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { getAppViewSnapshot } from "@hooks/useAppView";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { playCompletionSound } from "@utils/sounds";

const log = logger.scope("notifications");

const MAX_TITLE_LENGTH = 50;

function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_TITLE_LENGTH)}...`;
}

function shouldNotifyForTask(taskId?: string): boolean {
  if (!document.hasFocus()) return true;
  if (!taskId) return false;
  const view = getAppViewSnapshot();
  const viewedTaskId = view.type === "task-detail" ? view.taskId : undefined;
  return viewedTaskId !== taskId;
}

function sendDesktopNotification(
  title: string,
  body: string,
  silent: boolean,
  taskId?: string,
): void {
  trpcClient.notification.send
    .mutate({ title, body, silent, taskId })
    .catch((err) => {
      log.error("Failed to send notification", err);
    });
}

function showDockBadge(): void {
  trpcClient.notification.showDockBadge.mutate().catch((err) => {
    log.error("Failed to show dock badge", err);
  });
}

function bounceDock(): void {
  trpcClient.notification.bounceDock.mutate().catch((err) => {
    log.error("Failed to bounce dock", err);
  });
}

export function notifyPromptComplete(
  taskTitle: string,
  stopReason: string,
  taskId?: string,
): void {
  if (stopReason !== "end_turn") return;

  const {
    completionSound,
    completionVolume,
    desktopNotifications,
    dockBadgeNotifications,
    dockBounceNotifications,
  } = useSettingsStore.getState();

  if (!shouldNotifyForTask(taskId)) return;

  const willPlayCustomSound = completionSound !== "none";
  playCompletionSound(completionSound, completionVolume);

  if (desktopNotifications) {
    sendDesktopNotification(
      "PostHog Code",
      `"${truncateTitle(taskTitle)}" finished`,
      willPlayCustomSound,
      taskId,
    );
  }
  if (dockBadgeNotifications) {
    showDockBadge();
  }
  if (dockBounceNotifications) {
    bounceDock();
  }
}

export function notifyPermissionRequest(
  taskTitle: string,
  taskId?: string,
): void {
  const {
    completionSound,
    completionVolume,
    desktopNotifications,
    dockBadgeNotifications,
    dockBounceNotifications,
  } = useSettingsStore.getState();

  if (!shouldNotifyForTask(taskId)) return;

  const willPlayCustomSound = completionSound !== "none";
  playCompletionSound(completionSound, completionVolume);

  if (desktopNotifications) {
    sendDesktopNotification(
      "PostHog Code",
      `"${truncateTitle(taskTitle)}" needs your input`,
      willPlayCustomSound,
      taskId,
    );
  }
  if (dockBadgeNotifications) {
    showDockBadge();
  }
  if (dockBounceNotifications) {
    bounceDock();
  }
}
