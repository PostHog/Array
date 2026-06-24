import type { SaveMode } from "@posthog/core/save-mode/saveMode";
import type { SessionService } from "@posthog/core/sessions/sessionService";
import { SESSION_SERVICE } from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import { toast } from "@posthog/ui/primitives/toast";

export function useApplySaveMode(taskId: string | undefined) {
  const sessionService = useService<SessionService>(SESSION_SERVICE);

  return (nextMode: SaveMode) => {
    if (!taskId) return;
    void sessionService.applySaveMode(taskId, nextMode).then((changed) => {
      if (changed) {
        toast.success("Save mode applied to this session", {
          description:
            nextMode === "off"
              ? "Restored original model and effort settings"
              : "Model and effort adjusted · switching re-processes the conversation once",
        });
      }
    });
  };
}
