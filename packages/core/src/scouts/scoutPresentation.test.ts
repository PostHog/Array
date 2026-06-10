import type { ScoutConfig, ScoutRun } from "@posthog/api-client/posthog-client";
import { describe, expect, it } from "vitest";
import {
  computeFleetSummary,
  computeScoutRollups,
  deriveRunFailureKind,
  deriveRunOutcome,
  formatRunDuration,
  formatRunInterval,
  formatRunIntervalShort,
  getScoutOrigin,
  isRunStuck,
  normalizeRunStatus,
  prettifyScoutSkillName,
  runDurationSeconds,
  runMatchesFilter,
  scoutRunOutcomeLabel,
  scoutSkillNameFromSlug,
  scoutSkillSlug,
  sortConfigsForDisplay,
} from "./scoutPresentation";

const NOW = new Date("2026-06-10T12:00:00Z");

function makeRun(overrides: Partial<ScoutRun> = {}): ScoutRun {
  return {
    run_id: "run-1",
    skill_name: "signals-scout-error-tracking",
    skill_version: 3,
    status: "completed",
    started_at: "2026-06-10T11:00:00Z",
    completed_at: "2026-06-10T11:02:00Z",
    task_id: null,
    task_run_id: null,
    task_url: null,
    summary: "EMITTED nothing.",
    emitted_count: 0,
    emitted_finding_ids: [],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ScoutConfig> = {}): ScoutConfig {
  return {
    id: "config-1",
    skill_name: "signals-scout-error-tracking",
    enabled: true,
    emit: true,
    run_interval_minutes: 60,
    last_run_at: "2026-06-10T11:00:00Z",
    created_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("naming", () => {
  it("prettifies skill names", () => {
    expect(prettifyScoutSkillName("signals-scout-error-tracking")).toBe(
      "Error tracking",
    );
    expect(prettifyScoutSkillName("signals-scout-ai-observability")).toBe(
      "Ai observability",
    );
    expect(prettifyScoutSkillName("custom_thing")).toBe("Custom thing");
  });

  it("round-trips slugs", () => {
    expect(scoutSkillSlug("signals-scout-error-tracking")).toBe(
      "error-tracking",
    );
    expect(scoutSkillNameFromSlug("error-tracking")).toBe(
      "signals-scout-error-tracking",
    );
    expect(scoutSkillNameFromSlug("signals-scout-error-tracking")).toBe(
      "signals-scout-error-tracking",
    );
  });

  it("classifies canonical vs custom scouts", () => {
    expect(getScoutOrigin("signals-scout-error-tracking")).toBe("canonical");
    expect(getScoutOrigin("signals-scout-react-performance")).toBe("custom");
  });
});

describe("run status", () => {
  it("normalizes TaskRun statuses case-insensitively", () => {
    expect(normalizeRunStatus("COMPLETED")).toBe("completed");
    expect(normalizeRunStatus("failed")).toBe("failed");
    expect(normalizeRunStatus("IN_PROGRESS")).toBe("running");
    expect(normalizeRunStatus("queued")).toBe("queued");
    expect(normalizeRunStatus("something-else")).toBe("unknown");
  });

  it("computes duration, falling back to now for unfinished runs", () => {
    expect(runDurationSeconds(makeRun(), NOW)).toBe(120);
    const running = makeRun({
      status: "in_progress",
      started_at: "2026-06-10T11:58:00Z",
      completed_at: null,
    });
    expect(runDurationSeconds(running, NOW)).toBe(120);
    expect(runDurationSeconds(makeRun({ started_at: null }), NOW)).toBeNull();
  });

  it("formats durations", () => {
    expect(formatRunDuration(42)).toBe("42s");
    expect(formatRunDuration(134)).toBe("2m 14s");
    expect(formatRunDuration(3 * 3600)).toBe("3h");
    expect(formatRunDuration(null)).toBe("");
  });

  it("classifies long failed runs as timeouts", () => {
    const timedOut = makeRun({
      status: "failed",
      started_at: "2026-06-10T11:00:00Z",
      completed_at: "2026-06-10T11:30:10Z",
      summary: "",
    });
    expect(deriveRunFailureKind(timedOut, NOW)).toBe("timed_out");
    const errored = makeRun({
      status: "failed",
      completed_at: "2026-06-10T11:00:30Z",
    });
    expect(deriveRunFailureKind(errored, NOW)).toBe("error");
    expect(deriveRunFailureKind(makeRun(), NOW)).toBeNull();
  });

  it("flags in-progress runs past the deadline as stuck", () => {
    const stuck = makeRun({
      status: "in_progress",
      started_at: "2026-06-10T11:20:00Z",
      completed_at: null,
    });
    expect(isRunStuck(stuck, NOW)).toBe(true);
    const fresh = makeRun({
      status: "in_progress",
      started_at: "2026-06-10T11:55:00Z",
      completed_at: null,
    });
    expect(isRunStuck(fresh, NOW)).toBe(false);
    expect(isRunStuck(makeRun(), NOW)).toBe(false);
  });
});

describe("run outcomes", () => {
  it("classifies each run into a single outcome", () => {
    expect(deriveRunOutcome(makeRun({ emitted_count: 2 }), NOW)).toBe(
      "emitted",
    );
    expect(deriveRunOutcome(makeRun({ emitted_count: 0 }), NOW)).toBe("quiet");
    expect(
      deriveRunOutcome(
        makeRun({ status: "failed", completed_at: "2026-06-10T11:00:30Z" }),
        NOW,
      ),
    ).toBe("error");
    expect(
      deriveRunOutcome(
        makeRun({ status: "failed", completed_at: "2026-06-10T11:30:10Z" }),
        NOW,
      ),
    ).toBe("timed_out");
    expect(
      deriveRunOutcome(
        makeRun({
          status: "in_progress",
          started_at: "2026-06-10T11:55:00Z",
          completed_at: null,
        }),
        NOW,
      ),
    ).toBe("running");
    expect(
      deriveRunOutcome(
        makeRun({
          status: "in_progress",
          started_at: "2026-06-10T11:20:00Z",
          completed_at: null,
        }),
        NOW,
      ),
    ).toBe("stuck");
    expect(deriveRunOutcome(makeRun({ status: "queued" }), NOW)).toBe("queued");
  });

  it("labels outcomes with emitted counts", () => {
    expect(scoutRunOutcomeLabel(makeRun({ emitted_count: 1 }), NOW)).toBe(
      "1 signal emitted",
    );
    expect(scoutRunOutcomeLabel(makeRun({ emitted_count: 0 }), NOW)).toBe(
      "0 signals emitted",
    );
    expect(
      scoutRunOutcomeLabel(
        makeRun({ status: "failed", completed_at: "2026-06-10T11:30:10Z" }),
        NOW,
      ),
    ).toBe("timed out");
  });
});

describe("run filters", () => {
  const emitted = makeRun({ emitted_count: 2 });
  const quiet = makeRun({ emitted_count: 0 });
  const failed = makeRun({ status: "failed", emitted_count: 0 });

  it("matches runs to filter chips", () => {
    expect(runMatchesFilter(emitted, "emitted")).toBe(true);
    expect(runMatchesFilter(quiet, "emitted")).toBe(false);
    expect(runMatchesFilter(quiet, "quiet")).toBe(true);
    expect(runMatchesFilter(failed, "quiet")).toBe(false);
    expect(runMatchesFilter(failed, "failed")).toBe(true);
    expect(runMatchesFilter(emitted, "all")).toBe(true);
  });
});

describe("rollups", () => {
  it("aggregates per-scout counts and tracks latest/running runs", () => {
    const runs = [
      makeRun({ run_id: "a", started_at: "2026-06-10T10:00:00Z" }),
      makeRun({
        run_id: "b",
        started_at: "2026-06-10T11:00:00Z",
        emitted_count: 2,
      }),
      makeRun({
        run_id: "c",
        status: "failed",
        started_at: "2026-06-10T09:00:00Z",
      }),
      makeRun({
        run_id: "d",
        skill_name: "signals-scout-logs",
        status: "in_progress",
        started_at: "2026-06-10T11:58:00Z",
        completed_at: null,
      }),
    ];
    const rollups = computeScoutRollups(runs);
    const errorTracking = rollups.get("signals-scout-error-tracking");
    expect(errorTracking).toMatchObject({
      runCount: 3,
      completedCount: 2,
      failedCount: 1,
      emittedCount: 2,
    });
    expect(errorTracking?.latestRun?.run_id).toBe("b");
    expect(errorTracking?.runningRun).toBeNull();
    expect(rollups.get("signals-scout-logs")?.runningRun?.run_id).toBe("d");
    expect(errorTracking?.runs.map((run) => run.run_id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("computes the fleet summary", () => {
    const configs = [
      makeConfig(),
      makeConfig({
        id: "config-2",
        skill_name: "signals-scout-logs",
        enabled: false,
      }),
    ];
    const rollups = computeScoutRollups([
      makeRun({ emitted_count: 2 }),
      makeRun({ run_id: "x", status: "failed" }),
    ]);
    const summary = computeFleetSummary(configs, rollups);
    expect(summary).toMatchObject({
      totalCount: 2,
      enabledCount: 1,
      runningCount: 0,
      emittedCount: 2,
    });
    expect(summary.successRate).toBe(0.5);
  });

  it("returns a null success rate with no finished runs", () => {
    const summary = computeFleetSummary([], computeScoutRollups([]));
    expect(summary.successRate).toBeNull();
  });
});

describe("intervals and ordering", () => {
  it("formats intervals", () => {
    expect(formatRunInterval(60)).toBe("Hourly");
    expect(formatRunInterval(90)).toBe("Every 90 minutes");
    expect(formatRunInterval(2880)).toBe("Every 2 days");
    expect(formatRunIntervalShort(60)).toBe("hourly");
    expect(formatRunIntervalShort(180)).toBe("every 3h");
  });

  it("sorts enabled scouts first, then alphabetically", () => {
    const configs = [
      makeConfig({ skill_name: "signals-scout-logs", enabled: false }),
      makeConfig({ skill_name: "signals-scout-surveys" }),
      makeConfig({ skill_name: "signals-scout-error-tracking" }),
    ];
    expect(
      sortConfigsForDisplay(configs).map((config) => config.skill_name),
    ).toEqual([
      "signals-scout-error-tracking",
      "signals-scout-surveys",
      "signals-scout-logs",
    ]);
  });
});
