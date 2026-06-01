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

// How often the tracked tasks are re-polled. The renderer registers the tasks
// it cares about via getSnapshots; this loop keeps them fresh in the
// background. The production worker owns this cadence server-side.
const POLL_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Owns the PR-snapshot lifecycle: which tasks to watch, their cached CI/review
 * state, the refresh loop, and the `Updated` event the renderer subscribes to.
 * Resolution + acquisition live behind {@link PrSnapshotBackend} so this
 * service is the same code whether snapshots come from the local gh CLI or,
 * later, a PostHog realtime feed (docs/workflow-architecture.md §5).
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
   * Returns the current snapshots for the requested tasks, marking them tracked
   * for future polls. Tasks not yet cached are resolved inline so first paint
   * has real data; the rest come from cache and stay fresh via the poll loop.
   */
  async getSnapshots(tasks: TaskPrRef[]): Promise<TaskPrSnapshot[]> {
    for (const ref of tasks) this.tracked.set(ref.taskId, ref);

    const missing = tasks.filter((ref) => !this.cache.has(ref.taskId));
    if (missing.length > 0) await this.runRefresh(missing);

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
    const fresh = await this.backend.fetch(refs);
    const changed: TaskPrSnapshot[] = [];

    for (const { taskId, snapshot } of fresh) {
      const previous = this.cache.get(taskId);
      if (!previous || hasMaterialChange(previous, snapshot)) {
        changed.push({ taskId, snapshot });
      }
      this.cache.set(taskId, snapshot);
    }

    if (changed.length > 0) {
      this.emit(PrSnapshotEvent.Updated, changed);
      log.info("PR snapshots updated", { count: changed.length });
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
