import {
  type INotifications,
  NOTIFICATIONS_SERVICE,
} from "@posthog/platform/notifications";
import { playCompletionSound } from "@posthog/ui/utils/sounds";
import { inject, injectable } from "inversify";
import {
  ACTIVE_VIEW_PROVIDER,
  type IActiveView,
  type INotificationSettings,
  NOTIFICATION_SETTINGS_PROVIDER,
} from "./identifiers";

const MAX_TITLE_LENGTH = 50;

@injectable()
export class TaskNotificationService {
  constructor(
    @inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: INotifications,
    @inject(NOTIFICATION_SETTINGS_PROVIDER)
    private readonly settings: INotificationSettings,
    @inject(ACTIVE_VIEW_PROVIDER)
    private readonly view: IActiveView,
  ) {}

  notifyPromptComplete(
    taskTitle: string,
    stopReason: string,
    taskId?: string,
  ): void {
    if (stopReason !== "end_turn") return;
    this.dispatch(`"${this.truncateTitle(taskTitle)}" finished`, taskId);
  }

  notifyPermissionRequest(taskTitle: string, taskId?: string): void {
    this.dispatch(
      `"${this.truncateTitle(taskTitle)}" needs your input`,
      taskId,
    );
  }

  private dispatch(body: string, taskId?: string): void {
    if (!this.shouldNotify(taskId)) return;

    const settings = this.settings.get();
    const willPlayCustomSound = settings.completionSound !== "none";
    playCompletionSound(settings.completionSound, settings.completionVolume);

    if (settings.desktopNotifications) {
      this.notifications.notify({
        title: "PostHog Code",
        body,
        silent: willPlayCustomSound,
        taskId,
      });
    }
    if (settings.dockBadgeNotifications) {
      this.notifications.showUnreadIndicator();
    }
    if (settings.dockBounceNotifications) {
      this.notifications.requestAttention();
    }
  }

  private shouldNotify(taskId?: string): boolean {
    if (!this.view.hasFocus()) return true;
    if (!taskId) return false;
    return this.view.getActiveTaskId() !== taskId;
  }

  private truncateTitle(title: string): string {
    if (title.length <= MAX_TITLE_LENGTH) return title;
    return `${title.slice(0, MAX_TITLE_LENGTH)}...`;
  }
}
