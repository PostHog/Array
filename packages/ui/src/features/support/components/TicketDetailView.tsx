import { ArrowLeftIcon } from "@phosphor-icons/react";
import type { TicketMessage } from "@posthog/api-client/posthog-client";
import {
  Badge,
  Button,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
} from "@posthog/quill";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { navigateToSupport } from "@posthog/ui/router/navigationBridge";
import { Flex, Heading, Text } from "@radix-ui/themes";
import { useMemo } from "react";
import { useSupportTicket } from "../hooks/useSupportTicket";
import { useSupportTicketMessages } from "../hooks/useSupportTicketMessages";
import {
  assigneeDisplay,
  channelLabel,
  hasPriority,
  priorityLabel,
  requesterLabel,
  slaState,
  statusLabel,
} from "../ticketPresentation";

interface TicketDetailViewProps {
  ticketId: string;
}

export function TicketDetailView({ ticketId }: TicketDetailViewProps) {
  const { data: ticket, isPending, isError } = useSupportTicket(ticketId);
  const { data: messages } = useSupportTicketMessages(ticketId);
  const now = useMemo(() => new Date(), []);

  if (isPending) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>Loading ticket</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  if (isError || !ticket) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyTitle>Couldn't load this ticket</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  const assignee = assigneeDisplay(ticket.assignee);
  const sla = slaState(ticket.sla_due_at, now);

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex
        direction="column"
        gap="2"
        className="shrink-0 border-(--gray-4) border-b px-4 pt-3 pb-3"
      >
        <Flex align="center" gap="2">
          <Button
            aria-label="Back to Support"
            size="icon-sm"
            onClick={navigateToSupport}
          >
            <ArrowLeftIcon size={14} />
          </Button>
          <Heading size="3" className="min-w-0 truncate">
            {ticket.email_subject || requesterLabel(ticket)}
          </Heading>
          <Text className="shrink-0 text-(--gray-9) text-[12px]">
            #{ticket.ticket_number}
          </Text>
        </Flex>
        <Flex align="center" gap="2" wrap="wrap">
          <Badge variant="default">{statusLabel(ticket.status)}</Badge>
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
          <Text className="text-(--gray-10) text-[12px]">
            {channelLabel(ticket.channel_source)}
          </Text>
          <Text className="text-(--gray-10) text-[12px]">
            {assignee.kind === "role"
              ? `${assignee.label} (pool)`
              : assignee.label}
          </Text>
          <Text className="text-(--gray-10) text-[12px]">
            From {requesterLabel(ticket)}
          </Text>
        </Flex>
      </Flex>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages === undefined && (
          <Flex align="center" justify="center" className="py-8">
            <Spinner />
          </Flex>
        )}
        {messages?.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
        {messages?.length === 0 && (
          <Text className="text-(--gray-10) text-[13px]">
            No messages on this ticket yet.
          </Text>
        )}
      </div>
    </Flex>
  );
}

function MessageItem({ message }: { message: TicketMessage }) {
  return (
    <Flex direction="column" gap="1" className="py-2">
      <Flex align="center" gap="2">
        <Text className="font-medium text-[12px]">{message.author_name}</Text>
        {message.is_private && <Badge variant="warning">Internal</Badge>}
        <RelativeTimestamp timestamp={message.created_at} />
      </Flex>
      {/* Plain text for now; rich_content (TipTap JSON) rendering is a
          follow-up once the queue exists. */}
      <Text className="whitespace-pre-wrap text-[13px]">{message.content}</Text>
    </Flex>
  );
}
