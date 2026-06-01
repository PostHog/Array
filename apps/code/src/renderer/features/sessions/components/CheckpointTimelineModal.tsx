import {
  ArrowCounterClockwise,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import { isNotification, POSTHOG_NOTIFICATIONS } from "@posthog/agent";
import { Button, Dialog, Flex, ScrollArea, Text } from "@radix-ui/themes";
import type { AcpMessage } from "@shared/types/session-events";
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
} from "@shared/types/session-events";
import { formatRelativeTimeShort } from "@utils/time";
import { useMemo } from "react";

interface CheckpointEntry {
  checkpointId: string;
  timestamp: number;
  userMessageSnippet: string;
  turnIndex: number;
}

function parseTimeline(events: AcpMessage[]): CheckpointEntry[] {
  const entries: CheckpointEntry[] = [];
  let turnIndex = 0;
  let currentUserMessage = "";
  let currentCheckpointId: string | null = null;
  let currentCheckpointTs = 0;

  for (const event of events) {
    const msg = event.message;

    if (isJsonRpcRequest(msg) && msg.method === "session/prompt") {
      if (currentCheckpointId) {
        entries.push({
          checkpointId: currentCheckpointId,
          timestamp: currentCheckpointTs,
          userMessageSnippet: currentUserMessage,
          turnIndex,
        });
      }
      turnIndex++;
      const p = msg.params as {
        prompt?: Array<{ type: string; text?: string }>;
      };
      currentUserMessage =
        p?.prompt
          ?.filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("") ?? "";
      currentCheckpointId = null;
      currentCheckpointTs = 0;
    }

    if (
      isJsonRpcNotification(msg) &&
      isNotification(msg.method, POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT)
    ) {
      const params = msg.params as { checkpointId?: string };
      if (params?.checkpointId) {
        currentCheckpointId = params.checkpointId;
        currentCheckpointTs = event.ts;
      }
    }
  }

  if (currentCheckpointId) {
    entries.push({
      checkpointId: currentCheckpointId,
      timestamp: currentCheckpointTs,
      userMessageSnippet: currentUserMessage,
      turnIndex,
    });
  }

  return entries.reverse();
}

interface CheckpointTimelineModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: AcpMessage[];
  onRestore: (checkpointId: string) => void;
}

export function CheckpointTimelineModal({
  open,
  onOpenChange,
  events,
  onRestore,
}: CheckpointTimelineModalProps) {
  const entries = useMemo(() => parseTimeline(events), [events]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px" size="2">
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <ClockCounterClockwise size={16} className="text-(--accent-9)" />
            <Dialog.Title size="3" weight="medium" className="m-0">
              Checkpoint timeline
            </Dialog.Title>
          </Flex>
          {entries.length === 0 ? (
            <Text size="2" color="gray">
              No checkpoints in this session yet.
            </Text>
          ) : (
            <ScrollArea maxHeight="60vh">
              <Flex direction="column" gap="2" pr="2">
                {entries.map((entry) => (
                  <CheckpointRow
                    key={entry.checkpointId}
                    entry={entry}
                    onRestore={() => {
                      onOpenChange(false);
                      onRestore(entry.checkpointId);
                    }}
                  />
                ))}
              </Flex>
            </ScrollArea>
          )}
          <Flex justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray" size="2">
                Close
              </Button>
            </Dialog.Close>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function CheckpointRow({
  entry,
  onRestore,
}: {
  entry: CheckpointEntry;
  onRestore: () => void;
}) {
  const snippet = entry.userMessageSnippet.trim().slice(0, 120);
  const label = snippet || `Turn ${entry.turnIndex}`;

  return (
    <Flex
      align="start"
      justify="between"
      gap="3"
      className="rounded-(--radius-2) border border-(--gray-4) p-3"
    >
      <Flex direction="column" gap="1" className="min-w-0">
        <Text size="2" className="truncate text-(--gray-12)" weight="medium">
          {label}
        </Text>
        <Text size="1" color="gray">
          {formatRelativeTimeShort(entry.timestamp)}
        </Text>
      </Flex>
      <Button
        size="1"
        variant="soft"
        color="gray"
        onClick={onRestore}
        className="shrink-0"
      >
        <ArrowCounterClockwise size={12} />
        Restore
      </Button>
    </Flex>
  );
}
