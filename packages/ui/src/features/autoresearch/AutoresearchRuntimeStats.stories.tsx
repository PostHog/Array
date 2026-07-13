import type { AutoresearchRun } from "@posthog/core/autoresearch/schemas";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AutoresearchRuntimeStats } from "./AutoresearchRuntimeStats";

const STARTED_AT = Date.parse("2026-07-10T14:00:00Z");
const run: AutoresearchRun = {
  id: "run-runtime",
  config: {
    taskId: "task-1",
    direction: "minimize",
    targetValue: null,
    maxIterations: 10,
    implementModel: null,
    measureModel: null,
    implementEffort: null,
    measureEffort: null,
    instructions: "Reduce dashboard loading time.",
  },
  status: "completed",
  metricName: null,
  metricUnit: null,
  phase: null,
  originalModel: null,
  originalEffort: null,
  researchFindings: [],
  iterations: [],
  startedAt: STARTED_AT,
  endedAt: STARTED_AT + 26 * 60_000 + 17_000,
  endReason: "max-iterations",
  interruptedReason: null,
  lastError: null,
};

const meta: Meta<typeof AutoresearchRuntimeStats> = {
  title: "Autoresearch/Runtime Stats",
  component: AutoresearchRuntimeStats,
};

export default meta;
type Story = StoryObj<typeof AutoresearchRuntimeStats>;

export const WithContextUsage: Story = {
  args: {
    run,
    usage: {
      used: 175_000,
      size: 1_000_000,
      percentage: 18,
      cost: null,
      breakdown: null,
    },
  },
};

export const BeforeUsageUpdate: Story = { args: { run, usage: null } };
