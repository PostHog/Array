import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import { QueuedMessageView } from "@posthog/ui/features/sessions/components/session-update/QueuedMessageView";
import { useSupportsNativeSteer } from "@posthog/ui/features/sessions/hooks/useMessagingMode";
import { sessionStoreSetters } from "@posthog/ui/features/sessions/sessionStore";
import { useQueuedMessagesForTask } from "@posthog/ui/features/sessions/useSession";
import { Flex } from "@radix-ui/themes";

interface QueuedMessagesDockProps {
  taskId: string;
}

/**
 * Queued follow-ups pinned directly above the composer (outside the scrolling
 * thread) with per-message actions: steer it into the running turn now, or
 * discard it.
 */
export function QueuedMessagesDock({ taskId }: QueuedMessagesDockProps) {
  const queued = useQueuedMessagesForTask(taskId);
  const sessionService = useService<SessionService>(SESSION_SERVICE);
  const supportsNativeSteer = useSupportsNativeSteer(taskId);

  if (queued.length === 0) return null;

  return (
    <Flex direction="column" gap="1" className="mb-1">
      {queued.map((message) => (
        <QueuedMessageView
          key={message.id}
          message={message}
          supportsNativeSteer={supportsNativeSteer}
          onSteer={() => {
            void sessionService
              .steerQueuedMessage(taskId, message.id)
              .catch(() => {
                // Steer failed; the service already re-queued the message.
              });
          }}
          onRemove={() =>
            sessionStoreSetters.removeQueuedMessage(taskId, message.id)
          }
        />
      ))}
    </Flex>
  );
}
