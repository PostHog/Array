import {
  type MessagingMode,
  useMessagingModeStore,
} from "@posthog/ui/features/sessions/messagingModeStore";
import { useSessionStore } from "@posthog/ui/features/sessions/sessionStore";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";

/** Effective messaging mode for a task: per-task override, else global default. */
export function useMessagingMode(taskId: string | undefined): MessagingMode {
  const override = useMessagingModeStore((s) =>
    taskId ? s.modesByTaskId[taskId] : undefined,
  );
  const globalDefault = useSettingsStore((s) => s.defaultMessagingMode);
  return override ?? globalDefault;
}

/**
 * Whether the task's session steers natively (Claude, local) versus falling
 * back to interrupt-and-resend (Codex, cloud). Drives the steer label/tooltip,
 * not whether steer is allowed: every adapter supports steer in some form.
 */
export function useSupportsNativeSteer(taskId: string | undefined): boolean {
  return useSessionStore((s) => {
    if (!taskId) return false;
    const taskRunId = s.taskIdIndex[taskId];
    if (!taskRunId) return false;
    const session = s.sessions[taskRunId];
    return !!session && !session.isCloud && session.adapter === "claude";
  });
}
