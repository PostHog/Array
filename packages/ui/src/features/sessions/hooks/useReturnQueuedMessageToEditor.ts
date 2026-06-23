import {
  type EditorContent,
  xmlToContent,
} from "@posthog/core/message-editor/content";
import {
  combineQueuedCloudPrompts,
  promptToQueuedEditorContent,
} from "@posthog/core/sessions/cloudPrompt";
import { useDraftStore } from "@posthog/ui/features/message-editor/draftStore";
import {
  type QueuedMessage,
  sessionStoreSetters,
  useSessionForTask,
} from "@posthog/ui/features/sessions/sessionStore";
import { useCallback } from "react";

/**
 * Pull a queued message out of the queue and back into the composer so it can be
 * re-read or edited before re-sending. Mirrors the cancel-to-composer restore:
 * cloud keeps its rich payload (mentions, attachments) via the queued-cloud
 * conversion; local restores the plain text it was queued with.
 */
export function useReturnQueuedMessageToEditor(
  taskId: string | undefined,
): (message: QueuedMessage) => void {
  const { requestFocus, setPendingContent } = useDraftStore((s) => s.actions);
  const isCloud = useSessionForTask(taskId)?.isCloud ?? false;

  return useCallback(
    (message: QueuedMessage) => {
      if (!taskId) return;

      let pendingContent: EditorContent | null;
      if (isCloud) {
        const combined = combineQueuedCloudPrompts([message]);
        pendingContent = combined
          ? promptToQueuedEditorContent(combined)
          : null;
      } else {
        // Local queued content is the serialized form (text + `<file .../>`
        // tags); parse it back into chip segments so attachments restore as
        // chips, not raw XML.
        pendingContent = xmlToContent(message.content);
      }
      if (!pendingContent) return;

      sessionStoreSetters.removeQueuedMessage(taskId, message.id);
      setPendingContent(taskId, pendingContent);
      requestFocus(taskId);
    },
    [taskId, isCloud, requestFocus, setPendingContent],
  );
}
