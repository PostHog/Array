import { ROOT_LOGGER, type RootLogger } from "@posthog/di/logger";
import type { AgentSession, SagaLogger } from "@posthog/shared";
import { inject, injectable, preDestroy } from "inversify";
import { type SessionState, sessionStore } from "../sessions/sessionStore";
import {
  autoresearchStore,
  autoresearchStoreActions,
  getActiveRunForTask,
} from "./autoresearchStore";
import {
  AUTORESEARCH_SESSION_CLIENT,
  AUTORESEARCH_STORAGE_CLIENT,
  type AutoresearchSessionClient,
  type AutoresearchStorageClient,
} from "./identifiers";
import {
  buildContinuationPrompt,
  buildImplementPrompt,
  buildKickoffPrompt,
  buildMeasurePrompt,
  buildReportReminderPrompt,
  buildResumePrompt,
  countPromptRequests,
  extractLastAgentTurnText,
  parseMetricReport,
} from "./prompts";
import {
  type AutoresearchConfigInput,
  type AutoresearchEndReason,
  type AutoresearchInterruptionReason,
  type AutoresearchReport,
  type AutoresearchRun,
  autoresearchConfigSchema,
  isTerminalRunStatus,
  parseStoredAutoresearchRun,
} from "./schemas";
import { computeBest, evaluateContinuation, isImprovement } from "./stats";

let runCounter = 0;

/**
 * A missing report only counts against the agent after this grace period:
 * `isPromptPending` flips false before a failed send's stop reason (e.g.
 * rate_limited) reaches us, and the reminder must lose that race.
 */
export const REMINDER_GRACE_MS = 1_500;
export const RECOVERY_BASE_DELAY_MS = 60_000;
export const RECOVERY_MAX_DELAY_MS = 15 * 60_000;
/** Recovery gives up after this many attempts; manual Resume still works. */
export const MAX_RECOVERY_ATTEMPTS = 20;

/**
 * Drives autoresearch runs: sends the kickoff prompt, watches the task's
 * agent session, and each time the agent finishes a turn parses the metric
 * report, records the iteration, and either continues the loop, reminds the
 * agent to report, or ends the run.
 *
 * Infrastructure obstacles (session drop, idle-kill, usage limit, app
 * restart) never end a run: they mark it `interrupted` and the service keeps
 * trying to bring it back — reconnecting the session when it can and
 * resuming the loop once the session is usable again. Only the user
 * (pause/stop), the iteration budget, the target, or a protocol breakdown
 * (the agent repeatedly not reporting) ends a run. Every mutation is
 * persisted through the storage client so runs survive app restarts.
 */
@injectable()
export class AutoresearchService {
  @inject(ROOT_LOGGER)
  private rootLogger!: RootLogger;

  @inject(AUTORESEARCH_SESSION_CLIENT)
  private sessionClient!: AutoresearchSessionClient;

  @inject(AUTORESEARCH_STORAGE_CLIENT)
  private storage!: AutoresearchStorageClient;

  private logScoped: SagaLogger | null = null;

  private get log(): SagaLogger {
    if (this.logScoped === null) {
      this.logScoped = this.rootLogger.scope("autoresearch");
    }
    return this.logScoped;
  }

  private unsubscribe: (() => void) | null = null;
  /** Reminders already sent for the in-flight iteration, per run id. */
  private remindersSent = new Map<string, number>();
  /** Deferred missing-report reminders, cancelled if an interruption lands. */
  private pendingReminders = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Count of session/prompt requests already handled per run. A turn
   * completion is only processed when the count moved past this cursor —
   * `isPromptPending` flips without a new prompt when a send fails.
   */
  private promptCursor = new Map<string, number>();
  private recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private recoveryAttempts = new Map<string, number>();
  private hydratedTasks = new Set<string>();
  private rehydrated = false;

  /**
   * Register a run whose kickoff prompt the host has already delivered —
   * the create-task flow sends it as the new task's initial prompt. The
   * engine takes over from the agent's first reply.
   */
  registerRun(input: AutoresearchConfigInput): AutoresearchRun {
    const config = autoresearchConfigSchema.parse(input);

    const existing = getActiveRunForTask(
      autoresearchStore.getState(),
      config.taskId,
    );
    if (existing && !isTerminal(existing)) {
      throw new Error(
        `Autoresearch is already ${existing.status} for this task`,
      );
    }

    const run: AutoresearchRun = {
      id: `ar-${Date.now()}-${++runCounter}`,
      config,
      status: "running",
      metricName: null,
      phase: null,
      iterations: [],
      startedAt: Date.now(),
      endedAt: null,
      endReason: null,
      interruptedReason: null,
      lastError: null,
    };

    autoresearchStoreActions.upsertRun(run);
    const session = getSessionForTask(sessionStore.getState(), config.taskId);
    this.promptCursor.set(
      run.id,
      session ? countPromptRequests(session.events) : 0,
    );
    this.persist(run.id);
    this.ensureSubscribed();
    this.log.info("Autoresearch run registered", {
      runId: run.id,
      taskId: config.taskId,
      direction: config.direction,
    });
    return run;
  }

  /**
   * Register a run and send its kickoff into the task's existing session.
   * Used to start a fresh run on a task that already ran autoresearch.
   * (For composer-created tasks the kickoff rides the initial prompt and the
   * baseline turn runs on the task's creation model — stage models take over
   * from iteration 2.)
   */
  startRun(input: AutoresearchConfigInput): AutoresearchRun {
    const run = this.registerRun(input);
    // The kickoff's baseline is a measurement turn.
    if (isSplitRun(run)) {
      this.switchModel(run.id, run.config.taskId, run.config.measureModel);
    }
    void this.send(run.id, run.config.taskId, buildKickoffPrompt(run.config));
    return run;
  }

  pauseRun(runId: string): void {
    const run = autoresearchStore.getState().runs[runId];
    if (!run || (run.status !== "running" && run.status !== "interrupted")) {
      return;
    }
    this.clearReminder(runId);
    this.clearRecoveryTimer(runId);
    autoresearchStoreActions.setRunStatus(runId, "paused");
    this.persist(runId);
    // Hand the session back on the thinking model, not the measure one.
    if (isSplitRun(run)) {
      this.switchModel(runId, run.config.taskId, run.config.implementModel);
    }
    this.log.info("Autoresearch run paused", { runId });
  }

  resumeRun(runId: string): void {
    const run = autoresearchStore.getState().runs[runId];
    if (!run || (run.status !== "paused" && run.status !== "interrupted")) {
      return;
    }

    const decision = evaluateContinuation(run);
    if (decision.done) {
      this.endRun(runId, "completed", { endReason: decision.reason });
      return;
    }

    this.clearRecoveryTimer(runId);
    const session = getSessionForTask(
      sessionStore.getState(),
      run.config.taskId,
    );
    if (
      session !== undefined &&
      session.status === "connected" &&
      (session.isPromptPending || session.isCompacting)
    ) {
      // A turn is already in flight; the loop re-engages when it completes.
      // Don't move the cursor — that in-flight prompt is the next turn.
      autoresearchStoreActions.setRunStatus(runId, "running");
      this.persist(runId);
      this.log.info("Autoresearch run resumed", { runId });
      return;
    }
    if (!session || !isSessionUsable(session)) {
      // The session is down; let the recovery machinery bring it back and
      // resume the loop. Attempt immediately — the user asked for it now.
      autoresearchStoreActions.setRunStatus(runId, "interrupted", {
        interruptedReason: run.interruptedReason ?? "session-error",
      });
      this.persist(runId);
      void this.attemptRecovery(runId);
      return;
    }

    this.promptCursor.set(runId, countPromptRequests(session.events));
    autoresearchStoreActions.setRunStatus(runId, "running");
    this.persist(runId);
    this.log.info("Autoresearch run resumed", { runId });

    const current = autoresearchStore.getState().runs[runId];
    if (current) {
      this.switchModel(runId, run.config.taskId, phaseModel(current));
      void this.send(runId, run.config.taskId, promptForPhase(current));
    }
  }

  stopRun(runId: string): void {
    const run = autoresearchStore.getState().runs[runId];
    if (!run || isTerminal(run)) return;
    this.endRun(runId, "stopped", { endReason: "stopped-by-user" });
    this.log.info("Autoresearch run stopped", { runId });
  }

  /**
   * Restore persisted non-terminal runs after an app restart. Runs that were
   * mid-loop come back as `interrupted` and re-enter recovery, so a restart
   * pauses the loop instead of silently killing it.
   */
  async rehydrate(): Promise<void> {
    if (this.rehydrated) return;
    this.rehydrated = true;

    let stored: Awaited<ReturnType<AutoresearchStorageClient["listOpen"]>>;
    try {
      stored = await this.storage.listOpen();
    } catch (error) {
      this.log.error("Failed to restore autoresearch runs", { error });
      return;
    }

    const runs = stored
      .map((row) => parseStoredAutoresearchRun(row.data))
      .filter((run): run is AutoresearchRun => run !== null);
    if (runs.length === 0) return;

    autoresearchStoreActions.hydrateRuns(runs);
    this.ensureSubscribed();

    const state = autoresearchStore.getState();
    for (const runId of Object.values(state.activeRunIdByTask)) {
      const run = state.runs[runId];
      if (run?.status !== "interrupted") continue;
      // The stored blob still says "running"; persist the interruption.
      this.persist(run.id);
      this.scheduleRecovery(run.id);
    }
    this.log.info("Restored autoresearch runs", { count: runs.length });
  }

  /**
   * Load a task's persisted run history into the store (dashboard and
   * header entry point call this on mount). Cheap and idempotent.
   */
  async hydrateTask(taskId: string): Promise<void> {
    if (this.hydratedTasks.has(taskId)) return;
    this.hydratedTasks.add(taskId);

    let stored: Awaited<ReturnType<AutoresearchStorageClient["listByTask"]>>;
    try {
      stored = await this.storage.listByTask(taskId);
    } catch (error) {
      this.hydratedTasks.delete(taskId);
      this.log.error("Failed to load autoresearch runs for task", {
        taskId,
        error,
      });
      return;
    }

    const runs = stored
      .map((row) => parseStoredAutoresearchRun(row.data))
      .filter((run): run is AutoresearchRun => run !== null);
    if (runs.length === 0) return;

    autoresearchStoreActions.hydrateRuns(runs);
    if (runs.some((run) => !isTerminal(run))) {
      this.ensureSubscribed();
      const active = getActiveRunForTask(autoresearchStore.getState(), taskId);
      if (active?.status === "interrupted") this.scheduleRecovery(active.id);
    }
  }

  @preDestroy()
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const timer of this.pendingReminders.values()) clearTimeout(timer);
    this.pendingReminders.clear();
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer);
    this.recoveryTimers.clear();
    this.remindersSent.clear();
    this.recoveryAttempts.clear();
  }

  private ensureSubscribed(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = sessionStore.subscribe((state, prevState) => {
      this.onSessionStateChange(state, prevState);
    });
  }

  private onSessionStateChange(
    state: SessionState,
    prevState: SessionState,
  ): void {
    const { runs, activeRunIdByTask } = autoresearchStore.getState();
    for (const runId of Object.values(activeRunIdByTask)) {
      const run = runs[runId];
      if (!run || isTerminal(run)) continue;

      const session = getSessionForTask(state, run.config.taskId);
      if (!session) continue;
      const prevSession = getSessionForTask(prevState, run.config.taskId);

      if (session.status === "error" && prevSession?.status !== "error") {
        if (run.status === "running") {
          this.interrupt(
            run.id,
            "session-error",
            session.errorMessage ?? session.errorTitle ?? "Session error",
          );
        }
        continue;
      }

      if (run.status === "interrupted") {
        // Resume as soon as the session comes back — the reconnect may have
        // been ours (recovery) or the app's own reconciliation.
        if (isSessionUsable(session) && !isSessionUsable(prevSession)) {
          this.resumeFromInterruption(run.id);
        }
        continue;
      }

      const turnCompleted =
        prevSession?.isPromptPending === true &&
        session.isPromptPending === false;
      if (!turnCompleted) continue;

      const promptCount = countPromptRequests(session.events);
      if (promptCount <= (this.promptCursor.get(run.id) ?? 0)) continue;
      this.promptCursor.set(run.id, promptCount);
      this.onAgentTurnComplete(run, session);
    }
  }

  private onAgentTurnComplete(
    run: AutoresearchRun,
    session: AgentSession,
  ): void {
    const text = extractLastAgentTurnText(session.events);
    const report = parseMetricReport(text);

    if (!report) {
      // In a split run's implement phase a reportless turn is the expected
      // outcome: the change is in, now measure it on the measure model.
      const current = autoresearchStore.getState().runs[run.id];
      if (current?.status === "running" && current.phase === "implement") {
        this.beginMeasurePhase(current);
        return;
      }
      this.scheduleReminder(run.id);
      return;
    }

    this.clearReminder(run.id);
    this.remindersSent.delete(run.id);
    // The loop is demonstrably turning again; future interruptions restart
    // the recovery backoff from scratch.
    this.recoveryAttempts.delete(run.id);
    this.recordIteration(run, report);
    if (report.name) {
      const current = autoresearchStore.getState().runs[run.id];
      // First named report wins; a stable label keeps the dashboard steady.
      if (current && current.metricName === null) {
        autoresearchStoreActions.setMetricName(run.id, report.name);
      }
    }
    this.persist(run.id);

    const updated = autoresearchStore.getState().runs[run.id];
    if (!updated || updated.status !== "running") return;

    const decision = evaluateContinuation(updated);
    if (decision.done) {
      this.endRun(run.id, "completed", { endReason: decision.reason });
      this.log.info("Autoresearch run completed", {
        runId: run.id,
        reason: decision.reason,
        iterations: updated.iterations.length,
      });
      return;
    }

    this.continueLoop(updated);
  }

  /** Kick off the next iteration after a recorded report. */
  private continueLoop(run: AutoresearchRun): void {
    if (!isSplitRun(run)) {
      void this.send(run.id, run.config.taskId, buildContinuationPrompt(run));
      return;
    }
    autoresearchStoreActions.setPhase(run.id, "implement");
    this.persist(run.id);
    this.switchModel(run.id, run.config.taskId, run.config.implementModel);
    const current = autoresearchStore.getState().runs[run.id];
    if (current) {
      void this.send(run.id, run.config.taskId, buildImplementPrompt(current));
    }
  }

  private beginMeasurePhase(run: AutoresearchRun): void {
    autoresearchStoreActions.setPhase(run.id, "measure");
    this.persist(run.id);
    this.switchModel(run.id, run.config.taskId, run.config.measureModel);
    const current = autoresearchStore.getState().runs[run.id];
    if (current) {
      void this.send(run.id, run.config.taskId, buildMeasurePrompt(current));
    }
  }

  /**
   * Fire-and-forget model switch; a failed switch must not stop the loop —
   * the turn just runs on whatever model the session already has.
   */
  private switchModel(
    runId: string,
    taskId: string,
    model: string | null,
  ): void {
    if (model === null) return;
    void this.sessionClient.setModel(taskId, model).catch((error) => {
      this.log.warn("Autoresearch model switch failed; continuing", {
        runId,
        model,
        error,
      });
    });
  }

  /**
   * A turn ended without a report. Wait a grace period before reacting:
   * when the "turn" was really a failed send, its stop reason (rate limit,
   * cancel) arrives within the grace window and moots the reminder.
   */
  private scheduleReminder(runId: string): void {
    const run = autoresearchStore.getState().runs[runId];
    if (!run || run.status !== "running") return;
    if (this.pendingReminders.has(runId)) return;

    const timer = setTimeout(() => {
      this.pendingReminders.delete(runId);
      const current = autoresearchStore.getState().runs[runId];
      if (!current || current.status !== "running") return;

      const reminders = this.remindersSent.get(runId) ?? 0;
      if (reminders >= 1) {
        this.endRun(runId, "failed", {
          endReason: "missing-report",
          lastError: "The agent stopped reporting the metric after a reminder.",
        });
        return;
      }
      this.remindersSent.set(runId, reminders + 1);
      this.log.warn("Autoresearch turn had no metric report, reminding", {
        runId,
      });
      void this.send(
        runId,
        current.config.taskId,
        buildReportReminderPrompt(current),
      );
    }, REMINDER_GRACE_MS);
    this.pendingReminders.set(runId, timer);
  }

  private recordIteration(
    run: AutoresearchRun,
    report: AutoresearchReport,
  ): void {
    const previous = run.iterations[run.iterations.length - 1] ?? null;
    const best = computeBest(run.iterations, run.config.direction);
    const bestValue = isImprovement(
      report.value,
      best?.value ?? null,
      run.config.direction,
    )
      ? report.value
      : (best?.value ?? report.value);

    autoresearchStoreActions.appendIteration(run.id, {
      index: run.iterations.length + 1,
      value: report.value,
      bestValue,
      delta: previous ? report.value - previous.value : null,
      summary: report.summary,
      at: Date.now(),
    });
  }

  private async send(
    runId: string,
    taskId: string,
    prompt: string,
  ): Promise<void> {
    try {
      const { stopReason } = await this.sessionClient.sendPrompt(
        taskId,
        prompt,
      );
      if (stopReason === "rate_limited") {
        this.interrupt(
          runId,
          "rate-limited",
          "Usage limit reached. The loop retries automatically.",
        );
      } else if (stopReason === "cancelled") {
        // The user stopped the turn — hand them the wheel instead of
        // immediately re-prompting the agent they just silenced.
        const run = autoresearchStore.getState().runs[runId];
        if (run?.status === "running") {
          this.clearReminder(runId);
          autoresearchStoreActions.setRunStatus(runId, "paused");
          this.persist(runId);
          this.log.info("Autoresearch paused after user cancelled the turn", {
            runId,
          });
        }
      }
    } catch (error) {
      this.log.error("Failed to send autoresearch prompt", { runId, error });
      const current = autoresearchStore.getState().runs[runId];
      if (!current || isTerminal(current)) return;
      this.interrupt(
        runId,
        "send-failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private interrupt(
    runId: string,
    reason: AutoresearchInterruptionReason,
    lastError?: string,
  ): void {
    const run = autoresearchStore.getState().runs[runId];
    if (!run || isTerminal(run)) return;
    // A user pause outranks automation: record nothing, resume nothing.
    if (run.status === "paused") return;

    this.clearReminder(runId);
    autoresearchStoreActions.setRunStatus(runId, "interrupted", {
      interruptedReason: reason,
      lastError,
    });
    this.persist(runId);
    this.log.warn("Autoresearch run interrupted", { runId, reason, lastError });
    this.scheduleRecovery(runId);
  }

  private scheduleRecovery(runId: string): void {
    if (this.recoveryTimers.has(runId)) return;
    const attempts = this.recoveryAttempts.get(runId) ?? 0;
    if (attempts >= MAX_RECOVERY_ATTEMPTS) {
      this.log.warn("Autoresearch recovery gave up; resume manually", {
        runId,
        attempts,
      });
      return;
    }
    const delay = Math.min(
      RECOVERY_BASE_DELAY_MS * 2 ** attempts,
      RECOVERY_MAX_DELAY_MS,
    );
    const timer = setTimeout(() => {
      this.recoveryTimers.delete(runId);
      void this.attemptRecovery(runId);
    }, delay);
    this.recoveryTimers.set(runId, timer);
  }

  private async attemptRecovery(runId: string): Promise<void> {
    const run = autoresearchStore.getState().runs[runId];
    if (!run || run.status !== "interrupted") return;
    this.recoveryAttempts.set(
      runId,
      (this.recoveryAttempts.get(runId) ?? 0) + 1,
    );

    const session = getSessionForTask(
      sessionStore.getState(),
      run.config.taskId,
    );
    if (isSessionUsable(session)) {
      this.resumeFromInterruption(runId);
      return;
    }

    if (
      !session ||
      session.status === "error" ||
      session.status === "disconnected"
    ) {
      try {
        await this.sessionClient.reconnect(run.config.taskId);
      } catch (error) {
        this.log.warn("Autoresearch session reconnect failed; will retry", {
          runId,
          error,
        });
      }
    }

    // Either the connected transition resumes the run, or the next tick does.
    if (autoresearchStore.getState().runs[runId]?.status === "interrupted") {
      this.scheduleRecovery(runId);
    }
  }

  private resumeFromInterruption(runId: string): void {
    const run = autoresearchStore.getState().runs[runId];
    if (!run || run.status !== "interrupted") return;
    const reason = run.interruptedReason ?? "session-error";

    const decision = evaluateContinuation(run);
    if (decision.done) {
      this.endRun(runId, "completed", { endReason: decision.reason });
      return;
    }

    this.clearRecoveryTimer(runId);
    const session = getSessionForTask(
      sessionStore.getState(),
      run.config.taskId,
    );
    this.promptCursor.set(
      runId,
      session ? countPromptRequests(session.events) : 0,
    );
    autoresearchStoreActions.setRunStatus(runId, "running");
    this.persist(runId);
    this.log.info("Autoresearch run resuming after interruption", {
      runId,
      reason,
    });
    // A reconnected session comes back on its default model; re-apply the
    // phase's stage model before re-entering the loop.
    this.switchModel(runId, run.config.taskId, phaseModel(run));
    void this.send(runId, run.config.taskId, buildResumePrompt(run, reason));
  }

  private endRun(
    runId: string,
    status: "completed" | "stopped" | "failed",
    options: { endReason: AutoresearchEndReason; lastError?: string },
  ): void {
    const run = autoresearchStore.getState().runs[runId];
    autoresearchStoreActions.setRunStatus(runId, status, options);
    this.persist(runId);
    this.clearReminder(runId);
    this.clearRecoveryTimer(runId);
    this.remindersSent.delete(runId);
    this.recoveryAttempts.delete(runId);
    this.promptCursor.delete(runId);
    // Hand the session back on the thinking model, not the measure one.
    if (run && isSplitRun(run)) {
      this.switchModel(runId, run.config.taskId, run.config.implementModel);
    }
  }

  private clearReminder(runId: string): void {
    const timer = this.pendingReminders.get(runId);
    if (timer) clearTimeout(timer);
    this.pendingReminders.delete(runId);
  }

  private clearRecoveryTimer(runId: string): void {
    const timer = this.recoveryTimers.get(runId);
    if (timer) clearTimeout(timer);
    this.recoveryTimers.delete(runId);
  }

  /** Fire-and-forget write-through; the in-memory store stays authoritative. */
  private persist(runId: string): void {
    const run = autoresearchStore.getState().runs[runId];
    if (!run) return;
    void this.storage
      .save({
        id: run.id,
        taskId: run.config.taskId,
        endedAt: run.endedAt ? new Date(run.endedAt).toISOString() : null,
        data: JSON.stringify(run),
      })
      .catch((error) => {
        this.log.error("Failed to persist autoresearch run", { runId, error });
      });
  }
}

function isTerminal(run: AutoresearchRun): boolean {
  return isTerminalRunStatus(run.status);
}

/** Split runs alternate an implement turn and a measure turn per iteration. */
function isSplitRun(run: AutoresearchRun): boolean {
  return run.config.implementModel !== null && run.config.measureModel !== null;
}

/**
 * The stage model for the run's current phase; null means leave the session
 * model alone. A null phase is the baseline measurement when nothing is
 * recorded yet, otherwise it re-enters at the implement half.
 */
function phaseModel(run: AutoresearchRun): string | null {
  if (!isSplitRun(run)) return null;
  if (run.phase === "measure") return run.config.measureModel;
  if (run.phase === "implement") return run.config.implementModel;
  return run.iterations.length === 0
    ? run.config.measureModel
    : run.config.implementModel;
}

/** The prompt that re-enters the loop at the run's current phase. */
function promptForPhase(run: AutoresearchRun): string {
  if (run.phase === "implement") return buildImplementPrompt(run);
  if (run.phase === "measure") return buildMeasurePrompt(run);
  return buildContinuationPrompt(run);
}

function isSessionUsable(session: AgentSession | undefined): boolean {
  return (
    session !== undefined &&
    session.status === "connected" &&
    !session.isPromptPending &&
    !session.isCompacting
  );
}

function getSessionForTask(
  state: SessionState,
  taskId: string,
): AgentSession | undefined {
  const taskRunId = state.taskIdIndex[taskId];
  return taskRunId ? state.sessions[taskRunId] : undefined;
}
