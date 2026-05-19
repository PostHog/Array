import type { InboxReportOpenMethod } from "@shared/types/analytics";

let pendingMethod: InboxReportOpenMethod | null = null;

export function setPendingInboxOpenMethod(method: InboxReportOpenMethod): void {
  pendingMethod = method;
}

export function consumePendingInboxOpenMethod(): InboxReportOpenMethod {
  const m = pendingMethod ?? "unknown";
  pendingMethod = null;
  return m;
}
