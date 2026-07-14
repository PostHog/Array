import type { AutoresearchRun } from "@posthog/core/autoresearch/schemas";
import type { AcpMessage } from "@posthog/shared";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoresearchObservability } from "./AutoresearchObservability";

const STARTED_AT = 1_000;

function makeRun(overrides: Partial<AutoresearchRun> = {}): AutoresearchRun {
  return {
    id: "run-1",
    config: {
      taskId: "task-1",
      direction: "minimize",
      targetValue: null,
      maxIterations: 10,
      implementModel: null,
      measureModel: null,
      implementEffort: null,
      measureEffort: null,
      instructions: "Reduce memory usage.",
    },
    status: "running",
    metricName: null,
    metricUnit: null,
    phase: null,
    originalModel: null,
    originalEffort: null,
    researchFindings: [],
    iterations: [],
    startedAt: STARTED_AT,
    endedAt: null,
    endReason: null,
    interruptedReason: null,
    lastError: null,
    ...overrides,
  };
}

function toolCall(ts: number, kind: string): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          title: `tool at ${ts}`,
          kind,
          status: "completed",
        },
      },
    },
  } as AcpMessage;
}

function renderObservability(run: AutoresearchRun, events: AcpMessage[]) {
  return render(
    <Theme>
      <AutoresearchObservability run={run} events={events} />
    </Theme>,
  );
}

describe("AutoresearchObservability", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps observed-time bars within range when a kind outlasts wall-clock", () => {
    // Live run where the latest tool timestamp sits ahead of `now` (clock skew
    // between agent-set event timestamps and the client clock). The activity
    // analysis then attributes more elapsed time to one kind than the run's
    // wall-clock duration, which used to push Progress past its max of 100.
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 10_000);

    renderObservability(makeRun(), [
      toolCall(STARTED_AT, "edit"),
      toolCall(STARTED_AT + 25_000, "execute"),
    ]);

    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(4);
    for (const bar of bars) {
      const now = bar.getAttribute("aria-valuenow");
      // A rejected (out-of-range) value renders no aria-valuenow at all.
      expect(now).not.toBeNull();
      const value = Number(now);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});
