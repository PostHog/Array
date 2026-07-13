import type { AutoresearchRun } from "@posthog/core/autoresearch/schemas";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoresearchRuntimeStats } from "./AutoresearchRuntimeStats";

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
    startedAt: 1_000,
    endedAt: null,
    endReason: null,
    interruptedReason: null,
    lastError: null,
    ...overrides,
  };
}

function renderStats(
  run: AutoresearchRun,
  usage: React.ComponentProps<typeof AutoresearchRuntimeStats>["usage"],
) {
  return render(
    <Theme>
      <AutoresearchRuntimeStats run={run} usage={usage} />
    </Theme>,
  );
}

describe("AutoresearchRuntimeStats", () => {
  afterEach(() => vi.useRealTimers());

  it("shows elapsed time and live usage reported by the runtime", () => {
    vi.useFakeTimers();
    vi.setSystemTime(66_000);
    renderStats(makeRun(), {
      used: 42_800,
      size: 200_000,
      percentage: 21,
      cost: { amount: 1.284, currency: "USD" },
      breakdown: null,
    });

    expect(screen.getByText("1m 05s")).toBeVisible();
    expect(screen.getByText("43K / 200K")).toBeVisible();
    expect(screen.getByText("21% of current window")).toBeVisible();
  });

  it("uses the end time and explains unavailable usage", () => {
    renderStats(makeRun({ endedAt: 31_000, status: "completed" }), null);

    expect(screen.getByText("30s")).toBeVisible();
    expect(screen.getByText("Waiting")).toBeVisible();
    expect(screen.getByText("Total run time")).toBeVisible();
  });
});
