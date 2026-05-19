import type { InboxReportOpenMethod } from "@shared/types/analytics";

/**
 * Module-level register that lets click / keyboard / deep-link call sites annotate
 * the next `INBOX_REPORT_OPENED` event with the path that triggered it, without
 * threading the value through React props.
 *
 * A short TTL guards against a stale value being consumed if the call site sets
 * the method but the selection ends up unchanged (e.g. clicking the already-
 * selected report) — a later, unrelated open should not inherit the prior path.
 */
const PENDING_TTL_MS = 2_000;

let pendingMethod: InboxReportOpenMethod | null = null;
let setAt = 0;

export function setPendingInboxOpenMethod(method: InboxReportOpenMethod): void {
  pendingMethod = method;
  setAt = Date.now();
}

export function consumePendingInboxOpenMethod(): InboxReportOpenMethod {
  const isStale = Date.now() - setAt > PENDING_TTL_MS;
  const m = !isStale && pendingMethod ? pendingMethod : "unknown";
  pendingMethod = null;
  setAt = 0;
  return m;
}
