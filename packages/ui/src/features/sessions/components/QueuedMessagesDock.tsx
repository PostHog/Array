import { CaretDown, CaretRight, Stack } from "@phosphor-icons/react";
import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import { QueuedMessageView } from "@posthog/ui/features/sessions/components/session-update/QueuedMessageView";
import { useSupportsNativeSteer } from "@posthog/ui/features/sessions/hooks/useMessagingMode";
import { useReturnQueuedMessageToEditor } from "@posthog/ui/features/sessions/hooks/useReturnQueuedMessageToEditor";
import {
  sessionStoreSetters,
  useSessionIsCloud,
  useSessionSelector,
} from "@posthog/ui/features/sessions/sessionStore";
import {
  useQueueCollapsed,
  useSessionViewActions,
} from "@posthog/ui/features/sessions/sessionViewStore";
import { useQueuedMessagesForTask } from "@posthog/ui/features/sessions/useSession";
import { toast } from "@posthog/ui/primitives/toast";
import * as Collapsible from "@radix-ui/react-collapsible";
import { Box, Flex, Text } from "@radix-ui/themes";

interface QueuedMessagesDockProps {
  taskId: string;
}

/**
 * Queued follow-ups pinned directly above the composer (outside the scrolling
 * thread) with per-message actions: steer it into the running turn now, return
 * it to the composer to re-read or edit, or discard it.
 *
 * The list is bounded and scrolls internally so a long queue never pushes the
 * composer down or off-screen, and a header toggle lets the user collapse it.
 */
export function QueuedMessagesDock({ taskId }: QueuedMessagesDockProps) {
  const queued = useQueuedMessagesForTask(taskId);
  const sessionService = useService<SessionService>(SESSION_SERVICE);
  const supportsNativeSteer = useSupportsNativeSteer(taskId);
  const returnToEditor = useReturnQueuedMessageToEditor(taskId);
  // Narrow reads (not the whole session) so the dock doesn't re-render on every
  // streamed token while a turn is running.
  const isCompacting = useSessionSelector(
    taskId,
    (s) => s?.isCompacting ?? false,
  );
  const isCloud = useSessionIsCloud(taskId);
  // Steer can't inject mid-compaction, so it would be a silent no-op; hide it.
  // Cloud has no real mid-turn steer either (it would just interrupt the turn),
  // so hide it there too — the message stays queued and lands next turn.
  const canSteer = !isCompacting && !isCloud;
  const collapsed = useQueueCollapsed(taskId);
  const { setQueueCollapsed } = useSessionViewActions();

  if (queued.length === 0) return null;

  const isOpen = !collapsed;

  return (
    <Collapsible.Root
      open={isOpen}
      onOpenChange={(next) => setQueueCollapsed(taskId, !next)}
      className="mb-1"
    >
      <Collapsible.Trigger asChild>
        <button
          type="button"
          aria-label={
            isOpen ? "Collapse queued messages" : "Expand queued messages"
          }
          className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-gray-3"
        >
          {isOpen ? (
            <CaretDown size={12} className="text-gray-10" />
          ) : (
            <CaretRight size={12} className="text-gray-10" />
          )}
          <Stack size={14} className="shrink-0 text-gray-9" />
          <Text className="font-medium text-[13px] text-gray-11">
            {queued.length} queued
          </Text>
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Box className="max-h-[30vh] overflow-y-auto">
          <Flex direction="column" gap="1">
            {queued.map((message) => (
              <QueuedMessageView
                key={message.id}
                message={message}
                supportsNativeSteer={supportsNativeSteer}
                onSteer={
                  canSteer
                    ? () => {
                        void sessionService
                          .steerQueuedMessage(taskId, message.id)
                          .catch(() => {
                            toast.error(
                              "Couldn't steer this message. It's still queued.",
                            );
                          });
                      }
                    : undefined
                }
                onReturnToEditor={() => returnToEditor(message)}
                onRemove={() =>
                  sessionStoreSetters.removeQueuedMessage(taskId, message.id)
                }
              />
            ))}
          </Flex>
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
