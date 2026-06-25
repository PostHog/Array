import type { NotificationTarget } from "@posthog/platform/notifications";

// Whether two targets point at the same thing (same kind + ids).
export function targetsEqual(
  a: NotificationTarget | undefined,
  b: NotificationTarget | undefined,
): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "task" && b.kind === "task") return a.taskId === b.taskId;
  if (a.kind === "canvas" && b.kind === "canvas") {
    return a.channelId === b.channelId && a.dashboardId === b.dashboardId;
  }
  return false;
}

export type NotificationChannel = "suppress" | "toast" | "native";

// The focus-aware routing decision, the heart of the notification bus:
//   - app unfocused (user in another OS app) → native OS notification
//   - app focused, already looking at the target → suppress (they can see it)
//   - app focused, looking elsewhere → in-app toast
//
// Pure so it's exhaustively unit-tested without the DI graph.
export function routeNotification(args: {
  appFocused: boolean;
  viewingTarget: NotificationTarget | undefined;
  notificationTarget: NotificationTarget | undefined;
}): NotificationChannel {
  if (!args.appFocused) return "native";
  if (
    args.notificationTarget &&
    targetsEqual(args.viewingTarget, args.notificationTarget)
  ) {
    return "suppress";
  }
  return "toast";
}
