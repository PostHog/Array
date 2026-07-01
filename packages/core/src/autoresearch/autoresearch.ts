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
  AUTORESEARCH_PROMPT_CLIENT,
  type AutoresearchPromptClient,
} from "./identifiers";
import {
  buildContinuationPrompt,
  buildKickoffPrompt,
  buildReportReminderPrompt,
  extractLastAgentTurnText,
  parseMetricReport,
} from "./prompts";
import {
  type AutoresearchConfigInput,
  type AutoresearchReport,
  type AutoresearchRun,
  autoresearchConfigSchema,
} from "./schemas";
import { computeBest, evaluateContinuation, isImprovement } from "./stats";

let runCounter = 0;

/**
 * Drives autoresearch runs: sends the kickoff prompt, watches the task's
 * agent session, and each time the agent finishes a turn parses the metric
 * report, records the iteration, and either continues the loop, reminds the
 * agent to report, or ends the run.
 */
@injectable()
export class AutoresearchService {
  @inject(ROOT_LOGGER)
  private rootLogger!: RootLogger;

  @inject(AUTORESEARCH_PROMPT_CLIENT)
  private promptClient!: AutoresearchPromptClient;

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

  startRun(input: AutoresearchConfigInput): AutoresearchRun {
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
      iterations: [],
      startedAt: Date.now(),
      endedAt: null,
      endReason: null,
      lastError: null,
    };

    autoresearchStoreActions.upsertRun(run);
    this.ensureSubscribed();
    this.log.info("Autoresearch run started", {
      runId: run.id,
      taskId: config.taskId,
      metricName: config.metricName,
    });
    this.send(run.id, config.taskId, buildKickoffPrompt(config));
    return run;
  }

  pauseRun(runId: string): void {
    const run = autoresearchStore.getState().runs[runId];
    if (!run || run.status !== "running") return;
    autoresearchStoreActions.setRunStatus(runId, "paused");
    this.log.info("Autoresearch run paused", { runId });
  }

  resumeRun(runId: string): void {
    const run = autoresearchStore.getState().runs[runId];
    if (!run || run.status !== "paused") return;

    const decision = evaluateContinuation(run);
    if (decision.done) {
      autoresearchStoreActions.setRunStatus(runId, "completed", {
        endReason: decision.reason,
      });
      return;
    }

    autoresearchStoreActions.setRunStatus(runId, "running");
    this.log.info("Autoresearch run resumed", { runId });

    const session = getSessionForTask(
      sessionStore.getState(),
      run.config.taskId,
    );
    if (session && !session.isPromptPending) {
      const current = autoresearchStore.getState().runs[runId];
      if (current) {
        this.send(runId, run.config.taskId, buildContinuationPrompt(current));
      }
    }
  }

  stopRun(runId: string): void {
    const run = autoresearchStore.getState().runs[runId];
    if (!run || isTerminal(run)) return;
    autoresearchStoreActions.setRunStatus(runId, "stopped", {
      endReason: "stopped-by-user",
    });
    this.remindersSent.delete(runId);
    this.log.info("Autoresearch run stopped", { runId });
  }

  @preDestroy()
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.remindersSent.clear();
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
        autoresearchStoreActions.setRunStatus(run.id, "failed", {
          endReason: "session-error",
          lastError:
            session.errorMessage ?? session.errorTitle ?? "Session error",
        });
        this.remindersSent.delete(run.id);
        continue;
      }

      const turnCompleted =
        prevSession?.isPromptPending === true &&
        session.isPromptPending === false;
      if (turnCompleted) {
        this.onAgentTurnComplete(run, session);
      }
    }
  }

  private onAgentTurnComplete(
    run: AutoresearchRun,
    session: AgentSession,
  ): void {
    const text = extractLastAgentTurnText(session.events);
    const report = parseMetricReport(text);

    if (!report) {
      if (run.status !== "running") return;
      const reminders = this.remindersSent.get(run.id) ?? 0;
      if (reminders >= 1) {
        autoresearchStoreActions.setRunStatus(run.id, "failed", {
          endReason: "missing-report",
          lastError: "The agent stopped reporting the metric after a reminder.",
        });
        this.remindersSent.delete(run.id);
        return;
      }
      this.remindersSent.set(run.id, reminders + 1);
      this.log.warn("Autoresearch turn had no metric report, reminding", {
        runId: run.id,
      });
      this.send(
        run.id,
        run.config.taskId,
        buildReportReminderPrompt(run.config),
      );
      return;
    }

    this.remindersSent.delete(run.id);
    this.recordIteration(run, report);

    const updated = autoresearchStore.getState().runs[run.id];
    if (!updated || updated.status !== "running") return;

    const decision = evaluateContinuation(updated);
    if (decision.done) {
      autoresearchStoreActions.setRunStatus(run.id, "completed", {
        endReason: decision.reason,
      });
      this.log.info("Autoresearch run completed", {
        runId: run.id,
        reason: decision.reason,
        iterations: updated.iterations.length,
      });
      return;
    }

    this.send(run.id, run.config.taskId, buildContinuationPrompt(updated));
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

  private send(runId: string, taskId: string, prompt: string): void {
    void this.promptClient.sendPrompt(taskId, prompt).catch((error) => {
      this.log.error("Failed to send autoresearch prompt", { runId, error });
      autoresearchStoreActions.setRunStatus(runId, "failed", {
        endReason: "send-failed",
        lastError: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

function isTerminal(run: AutoresearchRun): boolean {
  return (
    run.status === "completed" ||
    run.status === "stopped" ||
    run.status === "failed"
  );
}

function getSessionForTask(
  state: SessionState,
  taskId: string,
): AgentSession | undefined {
  const taskRunId = state.taskIdIndex[taskId];
  return taskRunId ? state.sessions[taskRunId] : undefined;
}
