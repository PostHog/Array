import type { AgentSession } from "@posthog/shared";
import type { TaskRun, TaskRunStatus } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import { isCanvasGenerationRunning } from "./canvasGenerationStatus";

type Run = Pick<TaskRun, "environment" | "status">;
type Session = Pick<AgentSession, "status" | "cloudStatus">;

const run = (environment: "local" | "cloud", status: TaskRunStatus): Run => ({
  environment,
  status,
});
const session = (
  status: AgentSession["status"],
  cloudStatus?: TaskRunStatus,
): Session => ({ status, cloudStatus });

describe("isCanvasGenerationRunning", () => {
  it("is not running when there is no generation task", () => {
    expect(
      isCanvasGenerationRunning({
        genTaskId: null,
        genTaskLoading: false,
        latestRun: undefined,
        session: undefined,
      }),
    ).toBe(false);
  });

  it("assumes running while the task record is still loading", () => {
    expect(
      isCanvasGenerationRunning({
        genTaskId: "t1",
        genTaskLoading: true,
        latestRun: undefined,
        session: undefined,
      }),
    ).toBe(true);
  });

  it.each<[string, Run, Session | undefined, boolean]>([
    ["in_progress, no session", run("cloud", "in_progress"), undefined, true],
    [
      "session cloudStatus terminal overrides run record",
      run("cloud", "in_progress"),
      session("connected", "completed"),
      false,
    ],
    ["run record terminal", run("cloud", "failed"), undefined, false],
  ])("cloud: %s", (_label, latestRun, sess, expected) => {
    expect(
      isCanvasGenerationRunning({
        genTaskId: "t1",
        genTaskLoading: false,
        latestRun,
        session: sess,
      }),
    ).toBe(expected);
  });

  it("is running when loaded with no run record yet but a connected session", () => {
    // A task whose first run hasn't been created falls through to the local
    // path; isTerminalStatus(undefined) is false, so a live session decides.
    expect(
      isCanvasGenerationRunning({
        genTaskId: "t1",
        genTaskLoading: false,
        latestRun: undefined,
        session: session("connected"),
      }),
    ).toBe(true);
  });

  it.each<[string, Run, Session | undefined, boolean]>([
    [
      "session connected",
      run("local", "in_progress"),
      session("connected"),
      true,
    ],
    [
      "session connecting",
      run("local", "in_progress"),
      session("connecting"),
      true,
    ],
    ["no live session", run("local", "in_progress"), undefined, false],
    [
      "session disconnected",
      run("local", "in_progress"),
      session("disconnected"),
      false,
    ],
    // The regression: a terminal run record must stop "running" even if the
    // live session is still (stale) reporting connected — otherwise the canvas
    // is stranded on "Generating" forever.
    [
      "terminal run wins over stale connected session",
      run("local", "completed"),
      session("connected"),
      false,
    ],
    [
      "failed run wins over stale connected session",
      run("local", "failed"),
      session("connected"),
      false,
    ],
  ])("local: %s", (_label, latestRun, sess, expected) => {
    expect(
      isCanvasGenerationRunning({
        genTaskId: "t1",
        genTaskLoading: false,
        latestRun,
        session: sess,
      }),
    ).toBe(expected);
  });
});
