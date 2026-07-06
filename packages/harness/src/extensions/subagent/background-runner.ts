/**
 * Tracks detached (non-awaited) subagent runs for the lifetime of this pi
 * process, so a tool call can start a run and return immediately while
 * `/subagents-fleet` (or another tool call) checks on or interrupts it later.
 *
 * `lifecycle.ts`'s on-disk artifacts are the durable source of truth (they
 * survive this registry being empty, e.g. after a restart); this registry is
 * what makes `interrupt`/`stop` possible, since only the process that spawned
 * a child can kill it directly.
 */
import {
  createRunId,
  type EndRunExtra,
  endRun,
  type RunMode,
  runsDirectory,
  startRun,
} from "./lifecycle";

export interface BackgroundRunHandle {
  runId: string;
  mode: RunMode;
  agents: string[];
  startedAt: number;
  /** Resolved once the underlying run settles, successfully or not. */
  done: Promise<void>;
  /** Aborts the run's shared signal. Idempotent. */
  interrupt: () => void;
  isRunning: () => boolean;
}

export class BackgroundRunRegistry {
  private readonly runs = new Map<string, BackgroundRunHandle>();

  /**
   * Starts `fn` detached, tracking it under a new runId. `fn` is given the
   * abort signal to pass down to `runAgent`/`runPool`/`runChain`, and must
   * resolve/reject only once the underlying child process(es) have exited.
   */
  start(
    meta: { mode: RunMode; agents: string[] },
    fn: (signal: AbortSignal) => Promise<EndRunExtra>,
  ): BackgroundRunHandle {
    const runId = createRunId();
    const controller = new AbortController();
    let running = true;

    const status = startRun({ runId, mode: meta.mode, agents: meta.agents });

    const done = fn(controller.signal)
      .then((extra) => {
        endRun(
          status,
          controller.signal.aborted ? "aborted" : "completed",
          undefined,
          extra,
        );
      })
      .catch((error: unknown) => {
        endRun(
          status,
          controller.signal.aborted ? "aborted" : "failed",
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        running = false;
      });

    const handle: BackgroundRunHandle = {
      runId,
      mode: meta.mode,
      agents: meta.agents,
      startedAt: status.startedAt,
      done,
      interrupt: () => controller.abort(),
      isRunning: () => running,
    };

    this.runs.set(runId, handle);
    return handle;
  }

  get(runId: string): BackgroundRunHandle | undefined {
    return this.runs.get(runId);
  }

  list(): BackgroundRunHandle[] {
    return Array.from(this.runs.values());
  }

  interrupt(runId: string): boolean {
    const handle = this.runs.get(runId);
    if (!handle) return false;
    handle.interrupt();
    return true;
  }
}

/** Process-wide singleton: one registry per pi process (one per parent session). */
export const backgroundRuns = new BackgroundRunRegistry();

export { runsDirectory };
