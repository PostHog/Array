import { inboxStatusLabel } from "@posthog/core/inbox/statusLabels";
import type { SignalReportStatus } from "@posthog/shared/domain-types";
import { Badge } from "@posthog/ui/primitives/Badge";
import { Tooltip } from "@radix-ui/themes";

const STATUS_TOOLTIPS: Record<string, string> = {
  ready: "Research is complete. You can create a task from this report.",
  pending_input:
    "This report needs human input in PostHog before it can proceed.",
  in_progress: "An AI agent is actively researching this report's signals.",
  candidate: "Queued for research. An agent will pick this up shortly.",
  potential:
    "Gathering signals. The report will be queued once enough signals accumulate.",
  failed: "Research failed. The report may be retried automatically.",
  suppressed: "This report has been suppressed and is out of your inbox.",
  deleted: "This report has been deleted.",
};

type BadgeColor = "green" | "violet" | "amber" | "cyan" | "gray" | "red";

function inboxStatusBadgeColor(status: SignalReportStatus): BadgeColor {
  switch (status) {
    case "ready":
      return "green";
    case "pending_input":
      return "violet";
    case "in_progress":
      return "amber";
    case "candidate":
      return "cyan";
    case "failed":
      return "red";
    default:
      return "gray";
  }
}

interface SignalReportStatusBadgeProps {
  status: SignalReportStatus;
}

export function SignalReportStatusBadge({
  status,
}: SignalReportStatusBadgeProps) {
  const label = inboxStatusLabel(status);
  const tooltip = STATUS_TOOLTIPS[status] ?? status;
  const color = inboxStatusBadgeColor(status);

  return (
    <Tooltip content={tooltip}>
      <Badge color={color} className="cursor-help">
        {label}
      </Badge>
    </Tooltip>
  );
}
