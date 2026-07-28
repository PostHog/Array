import { LifebuoyIcon } from "@phosphor-icons/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
} from "@posthog/quill";
import { navigateToSupportTicketDetail } from "@posthog/ui/router/navigationBridge";
import { Flex, Heading, Text } from "@radix-ui/themes";
import { useMemo } from "react";
import { useSupportTickets } from "../hooks/useSupportTickets";
import { TicketRow } from "./TicketRow";

/**
 * PR 1 read path: newest-activity-first ticket list. Ranking (the attention
 * queue) replaces this ordering in PR 2 — keep this view dumb.
 */
export function SupportListView() {
  const { data, isPending, isError } = useSupportTickets({
    orderBy: "-updated_at",
  });
  const tickets = data?.results ?? [];
  // One clock per render keeps SLA chips consistent across rows.
  const now = useMemo(() => new Date(), []);

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex align="center" gap="2" className="shrink-0 px-4 pt-4 pb-2">
        <Heading size="4">Support</Heading>
        {data && (
          <Text className="text-(--gray-10) text-[12px]">
            {data.count} tickets
          </Text>
        )}
      </Flex>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {isPending && (
          <Empty className="h-full border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Spinner />
              </EmptyMedia>
              <EmptyTitle>Loading tickets</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
        {isError && (
          <Empty className="h-full border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LifebuoyIcon size={20} />
              </EmptyMedia>
              <EmptyTitle>Couldn't load tickets</EmptyTitle>
              <EmptyDescription>
                Check that Conversations is enabled for this project, then try
                again.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {!isPending && !isError && tickets.length === 0 && (
          <Empty className="h-full border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LifebuoyIcon size={20} />
              </EmptyMedia>
              <EmptyTitle>No tickets</EmptyTitle>
              <EmptyDescription>
                Customer tickets from Conversations will show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {tickets.map((ticket) => (
          <TicketRow
            key={ticket.id}
            ticket={ticket}
            now={now}
            onClick={() => navigateToSupportTicketDetail(ticket.id)}
          />
        ))}
      </div>
    </Flex>
  );
}
