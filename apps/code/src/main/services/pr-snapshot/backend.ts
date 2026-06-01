import { MAIN_TOKENS } from "@main/di/tokens";
import type { GitService } from "@main/services/git/service";
import type { TaskPrRef, TaskPrSnapshot } from "@shared/types/pr-snapshot";
import { inject, injectable } from "inversify";

/**
 * Single seam between {@link PrSnapshotService} and where PR/CI data comes
 * from. Today: the local gh CLI ({@link LocalPrSnapshotBackend}). When the
 * PostHog backend grows a PR-polling worker, a `CloudPrSnapshotBackend`
 * replaces this binding and the service above is unchanged — see
 * docs/workflow-architecture.md §5–6 for the migration plan.
 *
 * Contract for any implementation:
 * - `fetch` returns a snapshot per task it could resolve a PR for; tasks with
 *   no PR (or a transient failure) are simply omitted, never thrown.
 * - The returned snapshot shape is the canonical `PrSnapshot` regardless of
 *   source; resolution (cloud URL vs branch lookup) is the backend's concern.
 */
export interface PrSnapshotBackend {
  fetch(tasks: TaskPrRef[]): Promise<TaskPrSnapshot[]>;
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

  async fetch(tasks: TaskPrRef[]): Promise<TaskPrSnapshot[]> {
    const queue = [...tasks];
    const out: TaskPrSnapshot[] = [];

    const worker = async (): Promise<void> => {
      for (let ref = queue.shift(); ref; ref = queue.shift()) {
        const snapshot = await this.git
          .getTaskPrSnapshot(ref.taskId, ref.cloudPrUrl)
          .catch(() => null);
        if (snapshot) out.push({ taskId: ref.taskId, snapshot });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, worker),
    );
    return out;
  }
}

/**
 * Stub for the production path. Implemented when PostHog owns PR polling:
 * call the auth'd API, validate the response with `taskPrSnapshot`, return it.
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
