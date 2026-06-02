import { MAIN_TOKENS } from "@main/di/tokens";
import { logger } from "@main/utils/logger";
import { TypedEventEmitter } from "@main/utils/typed-event-emitter";
import {
  type PrSnapshot,
  PrSnapshotEvent,
  type PrSnapshotEvents,
  type TaskPrRef,
  type TaskPrSnapshot,
} from "@shared/types/pr-snapshot";
import { inject, injectable, postConstruct } from "inversify";
import type { PrSnapshotBackend } from "./backend";

const log = logger.scope("pr-snapshot");

// How often tracked tasks are re-polled to stay fresh. The production worker
// owns this cadence server-side.
const POLL_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Owns the PR-snapshot lifecycle: tracked tasks, cached CI/review state, the
 * refresh loop, and the `Updated` event the renderer subscribes to. Resolution
 * lives behind {@link PrSnapshotBackend} (docs/workflow-architecture.md §5).
 */
@injectable()
export class PrSnapshotService extends TypedEventEmitter<PrSnapshotEvents> {
  private readonly cache = new Map<string, PrSnapshot>();
  private readonly tracked = new Map<string, TaskPrRef>();
  private inflight: Promise<void> | null = null;

  constructor(
    @inject(MAIN_TOKENS.PrSnapshotBackend)
    private readonly backend: PrSnapshotBackend,
  ) {
    super();
  }

  @postConstruct()
  init(): void {
    const timer = setInterval(() => {
      void this.refresh().catch((error) => {
        log.warn("Scheduled PR snapshot refresh failed", { error });
      });
    }, POLL_INTERVAL_MS);
    // Don't keep the process alive for the poll loop.
    timer.unref?.();
  }

  /**
   * Returns cached snapshots for the requested tasks and marks them tracked.
   * Uncached tasks resolve in the background and stream in over `Updated`, so the
   * home tab fills in progressively rather than blocking on the slowest `gh` call.
   */
  async getSnapshots(tasks: TaskPrRef[]): Promise<TaskPrSnapshot[]> {
    for (const ref of tasks) this.tracked.set(ref.taskId, ref);

    const missing = tasks.filter((ref) => !this.cache.has(ref.taskId));
    if (missing.length > 0) {
      void this.runRefresh(missing).catch((error) => {
        log.warn("Inline PR snapshot resolve failed", { error });
      });
    }

    const out: TaskPrSnapshot[] = [];
    for (const ref of tasks) {
      const snapshot = this.cache.get(ref.taskId);
      if (snapshot) out.push({ taskId: ref.taskId, snapshot });
    }
    return out;
  }

  /**
   * Re-resolve the given tasks (or every tracked task), update the cache, and
   * emit only those that materially changed. Concurrent full refreshes dedupe
   * onto one in-flight run.
   */
  async refresh(tasks?: TaskPrRef[]): Promise<void> {
    const refs = tasks ?? [...this.tracked.values()];
    if (refs.length === 0) return;

    if (!tasks && this.inflight) return this.inflight;

    const run = this.runRefresh(refs);
    if (!tasks) {
      this.inflight = run.finally(() => {
        this.inflight = null;
      });
      return this.inflight;
    }
    return run;
  }

  private async runRefresh(refs: TaskPrRef[]): Promise<void> {
    // Emit per result as the backend resolves it (not one batch) so the renderer
    // can reposition each workstream as soon as its PR data lands.
    await this.backend.fetch(refs, (result) => this.applyResult(result));
  }

  /** Cache one resolved snapshot and emit it if it materially changed. */
  private applyResult(result: TaskPrSnapshot): void {
    const previous = this.cache.get(result.taskId);
    this.cache.set(result.taskId, result.snapshot);
    if (!previous || hasMaterialChange(previous, result.snapshot)) {
      this.emit(PrSnapshotEvent.Updated, [result]);
    }
  }
}

// Ignore churn (e.g. a bumped `lastUpdatedAt` with no state change) so we don't
// re-render the home tab for nothing — only the fields the classifier reads.
function hasMaterialChange(a: PrSnapshot, b: PrSnapshot): boolean {
  return (
    a.url !== b.url ||
    a.state !== b.state ||
    a.ciStatus !== b.ciStatus ||
    a.reviewDecision !== b.reviewDecision ||
    a.unresolvedThreads !== b.unresolvedThreads ||
    a.mergeable !== b.mergeable ||
    a.isCurrentUserRequestedReviewer !== b.isCurrentUserRequestedReviewer ||
    a.title !== b.title
  );
}
