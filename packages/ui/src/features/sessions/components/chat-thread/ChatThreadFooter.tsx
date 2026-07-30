import type { ContextUsage } from "@posthog/core/sessions/contextUsage";
import type { AcpMessage } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import type { BuildResult } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { SessionFooter } from "@posthog/ui/features/sessions/components/SessionFooter";
import { useContextUsage } from "@posthog/ui/features/sessions/hooks/useContextUsage";
import { useConversationItems } from "@posthog/ui/features/sessions/hooks/useConversationItems";
import {
  usePendingPermissionsForTask,
  useQueuedMessagesForTask,
  useSessionForTask,
} from "@posthog/ui/features/sessions/sessionStore";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";

interface ChatThreadFooterProps {
  events: AcpMessage[];
  isPromptPending: boolean | null;
  promptStartedAt?: number | null;
  task?: Task;
  taskId?: string;
  usage?: ContextUsage | null;
  footerState?: Omit<BuildResult, "items">;
}

/**
 * The session status footer (duration / queued / context usage / diff stats) for the new chat
 * thread, rendered UNDER the composer. The legacy `ConversationView` renders the same
 * `SessionFooter` at the bottom of the thread instead; here it lives under the input.
 *
 * Both thread variants pass `footerState` from their own parse plus empty
 * `footerEvents`, so the `useConversationItems` fallback below only ever sees
 * an empty transcript and stays non-persistent. Gated behind
 * `settingsStore.useNewChatThread` at the call site.
 */
export function ChatThreadFooter({
  events,
  isPromptPending,
  promptStartedAt,
  task,
  taskId,
  usage,
  footerState,
}: ChatThreadFooterProps) {
  const showDebugLogs = useSettingsStore((s) => s.debugLogsCloudRuns);
  const eventContextUsage = useContextUsage(events);
  const contextUsage = usage === undefined ? eventContextUsage : usage;
  const eventFooterState = useConversationItems(events, isPromptPending, {
    showDebugLogs,
  });
  const lastTurnInfo =
    footerState?.lastTurnInfo ?? eventFooterState.lastTurnInfo;
  const isCompacting =
    footerState?.isCompacting ?? eventFooterState.isCompacting;
  const completedToolCallCount =
    footerState?.completedToolCallCount ??
    eventFooterState.completedToolCallCount;
  const pendingPermissions = usePendingPermissionsForTask(taskId ?? "");
  const queuedCount = useQueuedMessagesForTask(taskId).length;
  const session = useSessionForTask(taskId);
  const pausedDurationMs = session?.pausedDurationMs ?? 0;

  return (
    <div className="pt-1">
      <SessionFooter
        task={task}
        isPromptPending={isPromptPending}
        promptStartedAt={promptStartedAt}
        lastGenerationDuration={
          lastTurnInfo?.isComplete
            ? Math.max(0, lastTurnInfo.durationMs - pausedDurationMs)
            : null
        }
        lastStopReason={lastTurnInfo?.stopReason}
        queuedCount={queuedCount}
        hasPendingPermission={pendingPermissions.size > 0}
        pausedDurationMs={pausedDurationMs}
        isCompacting={isCompacting}
        usage={contextUsage}
        completedToolCallCount={completedToolCallCount}
      />
    </div>
  );
}
