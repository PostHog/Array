import type { NotificationTarget } from "@posthog/platform/notifications";
import type {
  CompletionSound,
  CustomSound,
} from "@posthog/ui/features/settings/settingsStore";

export interface NotificationSettings {
  desktopNotifications: boolean;
  dockBadgeNotifications: boolean;
  dockBounceNotifications: boolean;
  completionSound: CompletionSound;
  completionVolume: number;
  scaleSoundWithTaskLength: boolean;
  customSounds: CustomSound[];
}

export interface INotificationSettings {
  get(): NotificationSettings;
}

export const NOTIFICATION_SETTINGS_PROVIDER = Symbol.for(
  "posthog.ui.notifications.settings",
);

export interface IActiveView {
  hasFocus(): boolean;
  // What the user is currently looking at, if it's a notifiable target (a task
  // or canvas). Used to suppress notifications for the thing already on screen.
  getActiveTarget(): NotificationTarget | undefined;
}

export const ACTIVE_VIEW_PROVIDER = Symbol.for(
  "posthog.ui.notifications.activeView",
);
