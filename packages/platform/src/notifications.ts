export interface NotificationOptions {
  title: string;
  body: string;
  silent: boolean;
  taskId?: string;
}

export interface INotifications {
  notify(options: NotificationOptions): void;
  showUnreadIndicator(): void;
  requestAttention(): void;
}

export const NOTIFICATIONS_SERVICE = Symbol.for(
  "posthog.platform.notifications",
);
