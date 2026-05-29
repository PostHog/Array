export const POSTHOG_NOTIFICATIONS = {
  BRANCH_CREATED: "_posthog/branch_created",
  RUN_STARTED: "_posthog/run_started",
  TASK_COMPLETE: "_posthog/task_complete",
  TURN_COMPLETE: "_posthog/turn_complete",
  ERROR: "_posthog/error",
  CONSOLE: "_posthog/console",
  SDK_SESSION: "_posthog/sdk_session",
  GIT_CHECKPOINT: "_posthog/git_checkpoint",
  MODE_CHANGE: "_posthog/mode_change",
  SESSION_RESUME: "_posthog/session/resume",
  USER_MESSAGE: "_posthog/user_message",
  CANCEL: "_posthog/cancel",
  CLOSE: "_posthog/close",
  STATUS: "_posthog/status",
  PROGRESS: "_posthog/progress",
  TASK_NOTIFICATION: "_posthog/task_notification",
  COMPACT_BOUNDARY: "_posthog/compact_boundary",
  USAGE_UPDATE: "_posthog/usage_update",
  PERMISSION_RESPONSE: "_posthog/permission_response",
  PERMISSION_REQUEST: "_posthog/permission_request",
  PERMISSION_RESOLVED: "_posthog/permission_resolved",
} as const;

type PosthogNotification =
  (typeof POSTHOG_NOTIFICATIONS)[keyof typeof POSTHOG_NOTIFICATIONS];

function matchesExt(method: string | undefined, expected: string): boolean {
  if (!method) return false;
  return method === expected || method === `_${expected}`;
}

export function isNotification(
  method: string | undefined,
  expected: PosthogNotification,
): boolean {
  return matchesExt(method, expected);
}
