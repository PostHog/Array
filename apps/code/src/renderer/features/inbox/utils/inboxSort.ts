import type { SignalReportStatus } from "@shared/types";

export function inboxStatusLabel(status: SignalReportStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "pending_input":
      return "Needs input";
    case "in_progress":
      return "Researching";
    case "candidate":
      return "Queued";
    case "potential":
      return "Gathering";
    case "failed":
      return "Failed";
    case "suppressed":
      return "Suppressed";
    case "deleted":
      return "Deleted";
    default:
      return status;
  }
}

export function inboxStatusAccentCss(status: SignalReportStatus): string {
  switch (status) {
    case "ready":
      return "var(--green-9)";
    case "pending_input":
      return "var(--violet-9)";
    case "in_progress":
      return "var(--amber-9)";
    case "candidate":
      return "var(--cyan-9)";
    case "potential":
      return "var(--gray-9)";
    case "failed":
      return "var(--red-9)";
    default:
      return "var(--gray-8)";
  }
}
