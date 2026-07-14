import type { NotebookSqlV2ResultEnvelope } from "@posthog/api-client/posthog-client";

/** What one poll of the run-status endpoint reported. */
export type SqlV2PollOutcome =
  | { status: "running" }
  | { status: "done"; result: NotebookSqlV2ResultEnvelope | null }
  | { status: "failed"; error: string | null }
  | { status: "disabled" };

export interface SqlV2RunTrackerDeps {
  poll: (runId: string) => Promise<SqlV2PollOutcome>;
  onDone: (runId: string, result: NotebookSqlV2ResultEnvelope | null) => void;
  onFailed: (runId: string, error: string) => void;
  onDisabled: () => void;
  intervalMs?: number;
  maxAttempts?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_POLL_ATTEMPTS = 150; // ~2.5 minutes at 1s — matches the webapp

/**
 * Polls a SQL v2 run until it terminates. Plain class (no React) so the poll
 * state machine is testable with fake timers. Semantics mirror the webapp's
 * notebookNodeSQLV2Logic:
 * - one poll in flight at a time (a slow response skips ticks, not queues);
 * - `start()` with a new runId supersedes the previous run — a stale in-flight
 *   response can neither report a result nor stop the new run's polling;
 * - gives up with `onFailed` after `maxAttempts` polls.
 */
export class SqlV2RunTracker {
  private readonly deps: SqlV2RunTrackerDeps;
  private activeRunId: string | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  /**
   * The runId whose poll is currently in flight. Keyed by runId (not a
   * boolean) so a superseding run's first poll isn't blocked by the stale
   * run's still-unresolved request.
   */
  private pollInFlightFor: string | null = null;

  constructor(deps: SqlV2RunTrackerDeps) {
    this.deps = deps;
  }

  get runningRunId(): string | null {
    return this.activeRunId;
  }

  start(runId: string): void {
    this.stop();
    this.activeRunId = runId;
    this.attempts = 0;
    void this.tick(runId);
    this.intervalId = setInterval(
      () => void this.tick(runId),
      this.deps.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.activeRunId = null;
  }

  private async tick(runId: string): Promise<void> {
    if (this.pollInFlightFor === runId || runId !== this.activeRunId) return;
    this.attempts += 1;
    if (this.attempts > (this.deps.maxAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS)) {
      this.stop();
      this.deps.onFailed(runId, "Timed out waiting for result");
      return;
    }
    this.pollInFlightFor = runId;
    try {
      const outcome = await this.deps.poll(runId);
      // A newer run started while this poll was in flight — drop the response.
      if (runId !== this.activeRunId) return;
      if (outcome.status === "done") {
        this.stop();
        this.deps.onDone(runId, outcome.result);
      } else if (outcome.status === "failed") {
        this.stop();
        this.deps.onFailed(runId, outcome.error ?? "Run failed");
      } else if (outcome.status === "disabled") {
        this.stop();
        this.deps.onDisabled();
      }
      // "running" → keep polling
    } catch (error) {
      if (runId !== this.activeRunId) return;
      this.stop();
      this.deps.onFailed(
        runId,
        error instanceof Error ? error.message : "Failed to fetch result",
      );
    } finally {
      if (this.pollInFlightFor === runId) {
        this.pollInFlightFor = null;
      }
    }
  }
}
