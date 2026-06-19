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
  useSessionForTask,
} from "@posthog/ui/features/sessions/sessionStore";
import { useQueuedMessagesForTask } from "@posthog/ui/features/sessions/useSession";
import { toast } from "@posthog/ui/primitives/toast";
import { Flex } from "@radix-ui/themes";

interface QueuedMessagesDockProps {
  taskId: string;
}

/**
 * Queued follow-ups pinned directly above the composer (outside the scrolling
 * thread) with per-message actions: steer it into the running turn now, return
 * it to the composer to re-read or edit, or discard it.
 */
export function QueuedMessagesDock({ taskId }: QueuedMessagesDockProps) {
  const queued = useQueuedMessagesForTask(taskId);
  const sessionService = useService<SessionService>(SESSION_SERVICE);
  const supportsNativeSteer = useSupportsNativeSteer(taskId);
  const returnToEditor = useReturnQueuedMessageToEditor(taskId);
  // Steer can't inject mid-compaction, so it would be a silent no-op; hide it.
  const isCompacting = useSessionForTask(taskId)?.isCompacting ?? false;

  if (queued.length === 0) return null;

  return (
    <Flex direction="column" gap="1" className="mb-1">
      {queued.map((message) => (
        <QueuedMessageView
          key={message.id}
          message={message}
          supportsNativeSteer={supportsNativeSteer}
          onSteer={
            isCompacting
              ? undefined
              : () => {
                  void sessionService
                    .steerQueuedMessage(taskId, message.id)
                    .catch(() => {
                      toast.error(
                        "Couldn't steer this message. It's still queued.",
                      );
                    });
                }
          }
          onReturnToEditor={() => returnToEditor(message)}
          onRemove={() =>
            sessionStoreSetters.removeQueuedMessage(taskId, message.id)
          }
        />
      ))}
    </Flex>
  );
}
