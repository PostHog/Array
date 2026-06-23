export interface LinkLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export const TASK_LINK_SERVICE = Symbol.for("posthog.core.taskLinkService");
export const INBOX_LINK_SERVICE = Symbol.for("posthog.core.inboxLinkService");
export const SCOUT_LINK_SERVICE = Symbol.for("posthog.core.scoutLinkService");
export const NEW_TASK_LINK_SERVICE = Symbol.for(
  "posthog.core.newTaskLinkService",
);
export const APPROVAL_LINK_SERVICE = Symbol.for(
  "posthog.core.approvalLinkService",
);
