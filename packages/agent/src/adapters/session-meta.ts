import { isCloudRun } from "../utils/common";

/** Minimal shape needed to resolve the effective task id from session meta. */
interface TaskIdSource {
  taskId?: string;
  persistence?: { taskId?: string };
}

/**
 * The task id can arrive directly on the session meta or nested under
 * `persistence`; prefer the top-level value. Shared by the Claude and Codex
 * adapters so the fallback chain stays in sync.
 */
export function resolveTaskId(
  meta: TaskIdSource | undefined,
): string | undefined {
  return meta?.taskId ?? meta?.persistence?.taskId;
}

/** Minimal shape needed to resolve spoken narration from session meta. */
interface SpokenNarrationSource {
  environment?: "local" | "cloud";
  spokenNarration?: boolean;
}

/**
 * An explicit setting wins; otherwise cloud runs (including sandbox runs
 * detected via `IS_SANDBOX`) default to on because the sandbox can't know
 * which clients are listening, so consumers gate playback. Local runs stay
 * silent. Shared by the Claude and Codex adapters.
 */
export function resolveSpokenNarration(
  meta: SpokenNarrationSource | undefined,
): boolean {
  return meta?.spokenNarration ?? isCloudRun(meta);
}
