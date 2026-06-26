import {
  type INotifications,
  NOTIFICATIONS_SERVICE,
  type NotificationTarget,
} from "@posthog/platform/notifications";
import { toast } from "@posthog/ui/primitives/toast";
import { openNotificationTarget } from "@posthog/ui/router/navigationBridge";
import { playCompletionSound } from "@posthog/ui/utils/sounds";
import { inject, injectable } from "inversify";
import {
  ACTIVE_VIEW_PROVIDER,
  type IActiveView,
  type INotificationSettings,
  NOTIFICATION_SETTINGS_PROVIDER,
} from "./identifiers";
import { routeNotification } from "./routeNotification";

const MAX_TITLE_LENGTH = 50;

// In-app toast presentation for the focused-but-elsewhere tier. Only levels that
// support an action link are allowed (the bus derives the action from `target`).
type ToastLevel = "success" | "error" | "warning";

export interface NotificationDescriptor {
  // Native title; defaults to "PostHog Code".
  title?: string;
  body: string;
  // What the notification is about — drives suppression (am I viewing it?) and
  // click navigation for both the toast and native tiers.
  target?: NotificationTarget;
  toast?: {
    level?: ToastLevel;
    description?: string;
    duration?: number;
  };
  silent?: boolean;
}

// The single channel every app notification flows through. Reads focus + the
// active route, decides suppress / toast / native (see routeNotification), and
// dispatches accordingly. Native delivery + dock effects are gated by the user's
// notification settings; the in-app toast always shows (it's non-intrusive and
// only appears while the app is focused).
@injectable()
export class NotificationBus {
  constructor(
    @inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: INotifications,
    @inject(NOTIFICATION_SETTINGS_PROVIDER)
    private readonly settings: INotificationSettings,
    @inject(ACTIVE_VIEW_PROVIDER)
    private readonly view: IActiveView,
  ) {}

  notify(descriptor: NotificationDescriptor): void {
    const channel = routeNotification({
      appFocused: this.view.hasFocus(),
      viewingTarget: this.view.getActiveTarget(),
      notificationTarget: descriptor.target,
    });
    if (channel === "suppress") return;

    const settings = this.settings.get();
    // Sound fires on both delivered tiers (toast + native), not on suppress —
    // matching the pre-bus behavior where any non-suppressed notification rang.
    playCompletionSound(settings.completionSound, settings.completionVolume);

    if (channel === "toast") {
      this.showToast(descriptor);
      return;
    }

    // native
    const willPlayCustomSound = settings.completionSound !== "none";
    if (settings.desktopNotifications) {
      this.notifications.notify({
        title: descriptor.title ?? "PostHog Code",
        body: descriptor.body,
        silent: descriptor.silent ?? willPlayCustomSound,
        target: descriptor.target,
      });
    }
    if (settings.dockBadgeNotifications)
      this.notifications.showUnreadIndicator();
    if (settings.dockBounceNotifications) this.notifications.requestAttention();
  }

  // --- Task-specific producers (delegate to notify) ---

  notifyPromptComplete(
    taskTitle: string,
    stopReason: string,
    taskId?: string,
  ): void {
    if (stopReason !== "end_turn") return;
    this.notify({
      body: `"${this.truncateTitle(taskTitle)}" finished`,
      target: taskId ? { kind: "task", taskId } : undefined,
      toast: { level: "success" },
    });
  }

  notifyPermissionRequest(taskTitle: string, taskId?: string): void {
    this.notify({
      body: `"${this.truncateTitle(taskTitle)}" needs your input`,
      target: taskId ? { kind: "task", taskId } : undefined,
      toast: { level: "warning" },
    });
  }

  private showToast(descriptor: NotificationDescriptor): void {
    const level = descriptor.toast?.level ?? "success";
    toast[level](descriptor.title ?? descriptor.body, {
      description: descriptor.toast?.description,
      duration: descriptor.toast?.duration,
      action: this.deriveAction(descriptor.target),
    });
  }

  private deriveAction(
    target: NotificationTarget | undefined,
  ): { label: string; onClick: () => void } | undefined {
    if (!target) return undefined;
    // Route through the shared open-target handler so the toast click lands on
    // the same place a native notification click would — channel-aware for
    // tasks filed to a channel. Label is the only kind-specific bit.
    const label = target.kind === "task" ? "View task" : "View canvas";
    return { label, onClick: () => openNotificationTarget(target) };
  }

  private truncateTitle(title: string): string {
    if (title.length <= MAX_TITLE_LENGTH) return title;
    return `${title.slice(0, MAX_TITLE_LENGTH)}...`;
  }
}
