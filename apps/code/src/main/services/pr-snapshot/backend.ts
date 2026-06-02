import { MAIN_TOKENS } from "@main/di/tokens";
import type { GitService } from "@main/services/git/service";
import { mapWithConcurrency } from "@posthog/git/concurrency";
import type { TaskPrRef, TaskPrSnapshot } from "@shared/types/pr-snapshot";
import { inject, injectable } from "inversify";

/**
 * Single seam between {@link PrSnapshotService} and where PR/CI data comes from.
 * Today the local gh CLI ({@link LocalPrSnapshotBackend}); a `CloudPrSnapshotBackend`
 * replaces the binding when PostHog owns PR polling (docs/workflow-architecture.md §5–6).
 *
 * Implementations: `fetch` returns one snapshot per resolvable task (omit, never
 * throw, on no-PR or failure); `onResolved` (optional) fires per task so callers
 * can stream rather than wait for the slowest.
 */
export interface PrSnapshotBackend {
  fetch(
    tasks: TaskPrRef[],
    onResolved?: (result: TaskPrSnapshot) => void,
  ): Promise<TaskPrSnapshot[]>;
}

// gh is rate-limited and each task is independent network work, so cap how many
// we resolve at once. Matches the concurrency cap in docs/home-tab.md §9.
const MAX_CONCURRENCY = 3;

@injectable()
export class LocalPrSnapshotBackend implements PrSnapshotBackend {
  constructor(
    @inject(MAIN_TOKENS.GitService)
    private readonly git: GitService,
  ) {}

  async fetch(
    tasks: TaskPrRef[],
    onResolved?: (result: TaskPrSnapshot) => void,
  ): Promise<TaskPrSnapshot[]> {
    const resolved = await mapWithConcurrency(
      tasks,
      MAX_CONCURRENCY,
      async (ref) => {
        const snapshot = await this.git
          .getTaskPrSnapshot(ref.taskId, ref.cloudPrUrl)
          .catch(() => null);
        if (!snapshot) return null;
        const result = { taskId: ref.taskId, snapshot };
        onResolved?.(result);
        return result;
      },
    );
    return resolved.filter((r): r is TaskPrSnapshot => r !== null);
  }
}

/**
 * Production stub: call the auth'd PostHog API and validate with `taskPrSnapshot`.
 * Flipping the DI binding to this is the entire client-side migration.
 */
@injectable()
export class CloudPrSnapshotBackend implements PrSnapshotBackend {
  async fetch(): Promise<TaskPrSnapshot[]> {
    throw new Error(
      "CloudPrSnapshotBackend not implemented yet — see docs/workflow-architecture.md",
    );
  }
}
