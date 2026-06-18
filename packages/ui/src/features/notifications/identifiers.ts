import type { CompletionSound } from "@posthog/ui/features/settings/settingsStore";

export interface NotificationSettings {
  desktopNotifications: boolean;
  dockBadgeNotifications: boolean;
  dockBounceNotifications: boolean;
  completionSound: CompletionSound;
  completionVolume: number;
}

export interface INotificationSettings {
  get(): NotificationSettings;
}

export const NOTIFICATION_SETTINGS_PROVIDER = Symbol.for(
  "posthog.ui.notifications.settings",
);

export interface IActiveView {
  hasFocus(): boolean;
  getActiveTaskId(): string | undefined;
}

export const ACTIVE_VIEW_PROVIDER = Symbol.for(
  "posthog.ui.notifications.activeView",
);
