import type {
  AutoresearchIteration,
  AutoresearchRun,
} from "@posthog/core/autoresearch/schemas";
import { Flex } from "@radix-ui/themes";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RunStats } from "./AutoresearchPanel";
import { AutoresearchRuntimeStats } from "./AutoresearchRuntimeStats";
import { IterationsTable } from "./IterationsTable";
import { MetricChart } from "./MetricChart";
import { PreBaselineState } from "./PreBaselineState";

/**
 * The run dashboard presentational stack includes stat cards, the metric
 * chart, and the iterations table. It matches `AutoresearchPanel` without header
 * controls and dialogs (which need a live service).
 */
function RunDashboard({ run }: { run: AutoresearchRun }) {
  if (run.iterations.length === 0) {
    return (
      <Flex direction="column" gap="4">
        <PreBaselineState
          run={run}
          sessionActivity={{
            status: "connected",
            isPromptPending: true,
            isCompacting: false,
          }}
        />
        <AutoresearchRuntimeStats run={run} usage={null} />
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="4">
      <RunStats run={run} />
      <MetricChart
        iterations={run.iterations}
        direction={run.config.direction}
        targetValue={run.config.targetValue}
        metricName={run.metricName ?? "the metric"}
        unit={run.metricUnit}
      />
      <AutoresearchRuntimeStats
        run={run}
        usage={{
          used: 42_800,
          size: 200_000,
          percentage: 21,
          cost: null,
          breakdown: null,
        }}
      />
      <IterationsTable
        iterations={run.iterations}
        direction={run.config.direction}
        unit={run.metricUnit}
      />
    </Flex>
  );
}

const BASE_AT = Date.parse("2026-07-07T09:00:00Z");

const iterationsFrom = (
  values: number[],
  direction: AutoresearchRun["config"]["direction"],
  summaries: (string | null)[] = [],
): AutoresearchIteration[] => {
  let best: number | null = null;
  return values.map((value, i) => {
    best =
      best === null || (direction === "minimize" ? value < best : value > best)
        ? value
        : best;
    return {
      index: i + 1,
      value,
      bestValue: best,
      delta: i === 0 ? null : value - values[i - 1],
      summary: summaries[i] ?? null,
      at: BASE_AT + i * 8 * 60_000,
    };
  });
};

const run = (overrides: Partial<AutoresearchRun> = {}): AutoresearchRun => ({
  id: "run-1",
  config: {
    taskId: "task-1",
    direction: "minimize",
    targetValue: 380,
    maxIterations: 12,
    implementModel: null,
    measureModel: null,
    implementEffort: null,
    measureEffort: null,
    instructions: "Shrink the renderer bundle without breaking tests.",
  },
  status: "running",
  metricName: "bundle size",
  metricUnit: "kB",
  phase: null,
  originalModel: null,
  originalEffort: null,
  researchFindings: [],
  iterations: [],
  startedAt: BASE_AT,
  endedAt: null,
  endReason: null,
  interruptedReason: null,
  lastError: null,
  ...overrides,
});

const meta: Meta<typeof RunDashboard> = {
  title: "Autoresearch/RunDashboard",
  component: RunDashboard,
  // Match the panel's column width so cards, chart, and table size realistically.
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 760, margin: "2rem auto", padding: "0 1rem" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof RunDashboard>;

/** A minimize run in progress with noisy results, the best frontier, and a target. */
export const MinimizeInProgress: Story = {
  args: {
    run: run({
      iterations: iterationsFrom(
        [512, 498, 505, 461, 442, 449, 407, 398],
        "minimize",
        [
          "Baseline",
          "Tree-shake icon imports",
          "Revert: broke lazy routes",
          "Split vendor chunk",
          "Drop moment locales",
          "Inline critical CSS (regression)",
          "Lazy-load diff worker",
          "Dedupe zod versions",
        ],
      ),
    }),
  },
};

/** A completed maximize run with no target. The loop spent its budget. */
export const MaximizeCompleted: Story = {
  args: {
    run: run({
      status: "completed",
      endedAt: BASE_AT + 10 * 8 * 60_000,
      endReason: "max-iterations",
      metricName: "cache hit rate",
      metricUnit: "%",
      config: {
        ...run().config,
        direction: "maximize",
        targetValue: null,
        maxIterations: 10,
      },
      iterations: iterationsFrom(
        [62, 71, 68, 74, 79, 77, 83, 82, 86, 85],
        "maximize",
        [
          "Baseline",
          "Warm cache on boot",
          null,
          "Bigger LRU",
          null,
          null,
          "Precompute keys",
          null,
          "Batch invalidations",
          null,
        ],
      ),
    }),
  },
};

/** Before the first metric report arrives: active baseline measurement. */
export const NoIterationsYet: Story = {
  args: { run: run() },
};
