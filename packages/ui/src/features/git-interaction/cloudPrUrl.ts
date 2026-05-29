import type { Task } from "@posthog/shared/domain-types";
import type { AgentSession } from "@posthog/ui/features/sessions/sessionStore";

/**
 * Extracts the PR URL from a task and/or session. The URL can arrive via the
 * persisted TaskRun output or the live session's cloudOutput (pushed over SSE
 * while the run is active), so both sources are consulted.
 */
export function resolveCloudPrUrl(
  task: Task | undefined,
  session: AgentSession | undefined,
): string | null {
  const taskPrUrl = task?.latest_run?.output?.pr_url;
  const sessionPrUrl = session?.cloudOutput?.pr_url;

  if (typeof taskPrUrl === "string" && taskPrUrl) return taskPrUrl;
  if (typeof sessionPrUrl === "string" && sessionPrUrl) return sessionPrUrl;
  return null;
}
