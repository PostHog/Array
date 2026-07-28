import type { Ticket } from "@posthog/api-client/posthog-client";
import { Badge } from "@posthog/quill";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { Flex, Text } from "@radix-ui/themes";
import {
  assigneeDisplay,
  channelLabel,
  hasPriority,
  priorityLabel,
  requesterLabel,
  slaState,
  statusLabel,
  ticketPreview,
} from "../ticketPresentation";

interface TicketRowProps {
  ticket: Ticket;
  now: Date;
  onClick: () => void;
}

const STATUS_BADGE_VARIANT: Record<
  string,
  "default" | "info" | "warning" | "success" | "completed"
> = {
  new: "info",
  open: "default",
  pending: "warning",
  on_hold: "default",
  resolved: "completed",
};

export function TicketRow({ ticket, now, onClick }: TicketRowProps) {
  const assignee = assigneeDisplay(ticket.assignee);
  const sla = slaState(ticket.sla_due_at, now);
  const preview = ticketPreview(ticket);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full cursor-pointer rounded-md px-3 py-2 text-left hover:bg-(--gray-3)"
    >
      <Flex align="center" gap="2" className="min-w-0">
        <Text className="shrink-0 font-medium text-[13px]">
          {requesterLabel(ticket)}
        </Text>
        {ticket.unread_team_count > 0 && (
          <Badge variant="info">{ticket.unread_team_count} new</Badge>
        )}
        <Text className="min-w-0 flex-1 truncate text-(--gray-10) text-[13px]">
          {preview}
        </Text>
        <RelativeTimestamp
          timestamp={ticket.last_message_at ?? ticket.updated_at}
        />
      </Flex>
      <Flex align="center" gap="2" mt="1" className="min-w-0">
        <Badge variant={STATUS_BADGE_VARIANT[ticket.status ?? "new"]}>
          {statusLabel(ticket.status)}
        </Badge>
        {/* Untriaged is a distinct state — never render it as low priority. */}
        <Badge variant={hasPriority(ticket.priority) ? "default" : "warning"}>
          {priorityLabel(ticket.priority)}
        </Badge>
        {sla.kind === "breached" && (
          <Badge variant="destructive">SLA breached</Badge>
        )}
        {sla.kind === "due" && (
          <Badge variant="warning">
            SLA <RelativeTimestamp timestamp={sla.dueAt} />
          </Badge>
        )}
        <Text className="text-(--gray-9) text-[11px]">
          {channelLabel(ticket.channel_source)}
        </Text>
        <Text className="ml-auto shrink-0 text-(--gray-9) text-[11px]">
          {assignee.kind === "role"
            ? `${assignee.label} (pool)`
            : assignee.label}
        </Text>
      </Flex>
    </button>
  );
}
