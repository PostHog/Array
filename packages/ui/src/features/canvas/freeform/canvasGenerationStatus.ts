import type { AgentSession } from "@posthog/shared";
import { isTerminalStatus, type TaskRun } from "@posthog/shared/domain-types";

export interface CanvasGenerationStatusInput {
  /** The canvas's in-flight generation task id, or null if none. */
  genTaskId: string | null;
  /** True while the task record is still loading for the first time. */
  genTaskLoading: boolean;
  /** The task's latest run record (carries environment + persisted status). */
  latestRun: Pick<TaskRun, "environment" | "status"> | undefined;
  /** The live ACP session for the task, if one is connected in this client. */
  session: Pick<AgentSession, "status" | "cloudStatus"> | undefined;
}

// Whether a canvas generation task is still actively running.
//
// Cloud and local report progress through different channels:
//   - cloud: status comes from the live session's `cloudStatus`, falling back to
//     the persisted run record — running until that status is terminal.
//   - local: progress is tied to the live ACP session (connecting/connected).
//     But the session can go stale or stall without cleanly disconnecting, so a
//     terminal run record (completed/failed/cancelled) ALWAYS wins — otherwise a
//     hung session pins the canvas in the "Generating" state indefinitely.
export function isCanvasGenerationRunning({
  genTaskId,
  genTaskLoading,
  latestRun,
  session,
}: CanvasGenerationStatusInput): boolean {
  if (!genTaskId) return false;
  // Assume running while the task record is still loading.
  if (genTaskLoading) return true;

  if (latestRun?.environment === "cloud") {
    const cloudStatus = session?.cloudStatus ?? latestRun.status;
    return !isTerminalStatus(cloudStatus);
  }

  // Local: a terminal run record means the run is done regardless of a stale or
  // stuck live session, so it can never strand the canvas on "Generating".
  if (isTerminalStatus(latestRun?.status)) return false;
  return session?.status === "connecting" || session?.status === "connected";
}
