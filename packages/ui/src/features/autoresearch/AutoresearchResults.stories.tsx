import type { AutoresearchRun } from "@posthog/core/autoresearch/schemas";
import { Flex } from "@radix-ui/themes";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RunStats, RunSummary } from "./AutoresearchPanel";
import { IterationsTable } from "./IterationsTable";

const STARTED_AT = Date.parse("2026-07-10T14:00:00Z");
const run: AutoresearchRun = {
  id: "run-results",
  config: {
    taskId: "task-1",
    direction: "minimize",
    targetValue: 300,
    maxIterations: 3,
    implementModel: null,
    measureModel: null,
    implementEffort: null,
    measureEffort: null,
    instructions: "Reduce dashboard loading time.",
  },
  status: "completed",
  metricName: "dashboard bundle",
  metricUnit: "KiB",
  phase: null,
  originalModel: null,
  originalEffort: null,
  researchFindings: [],
  iterations: [
    {
      index: 1,
      value: 3850.7,
      bestValue: 3850.7,
      delta: null,
      summary: "Established the baseline",
      hypothesis: "The eager graph defines the current cost",
      plan: "Measure the marginal dashboard bundle",
      approach: "baseline",
      at: STARTED_AT + 5 * 60_000,
    },
    {
      index: 2,
      value: 3320.4,
      bestValue: 3320.4,
      delta: -530.3,
      summary: "Lazy loaded dashboard modals",
      hypothesis: "Modal imports dominate the eager route",
      plan: "Split modal imports and remeasure",
      approach: "code splitting",
      at: STARTED_AT + 15 * 60_000,
    },
    {
      index: 3,
      value: 3208.1,
      bestValue: 3208.1,
      delta: -112.3,
      summary: "Deferred the insight editor",
      hypothesis: "The editor is unused during initial dashboard render",
      plan: "Load the editor when add insight opens",
      approach: "lazy loading",
      at: STARTED_AT + 25 * 60_000,
    },
  ],
  startedAt: STARTED_AT,
  endedAt: STARTED_AT + 26 * 60_000,
  endReason: "max-iterations",
  interruptedReason: null,
  lastError: null,
};

function Results({ run }: { run: AutoresearchRun }) {
  return (
    <Flex direction="column" gap="4">
      <RunStats run={run} />
      <IterationsTable
        iterations={run.iterations}
        direction={run.config.direction}
        unit={run.metricUnit}
      />
      <RunSummary run={run} />
    </Flex>
  );
}

const meta: Meta<typeof Results> = {
  title: "Autoresearch/Results and Summary",
  component: Results,
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[760px] p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Results>;

export const CompletedRun: Story = { args: { run } };

export const BaselineJustRecorded: Story = {
  args: {
    run: {
      ...run,
      status: "running",
      endedAt: null,
      iterations: [run.iterations[0]],
    },
  },
};
