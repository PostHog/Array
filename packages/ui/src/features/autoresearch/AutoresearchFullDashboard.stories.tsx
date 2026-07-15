import type {
  AutoresearchDirection,
  AutoresearchIteration,
  AutoresearchRun,
  AutoresearchRunStatus,
} from "@posthog/core/autoresearch/schemas";
import type { AcpMessage } from "@posthog/shared";
import { Badge, Button, Flex, Text } from "@radix-ui/themes";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AutoresearchObservability } from "./AutoresearchObservability";
import { RunStats, RunSummary } from "./AutoresearchPanel";
import { AutoresearchRuntimeStats } from "./AutoresearchRuntimeStats";
import { IterationsTable } from "./IterationsTable";
import { MetricChart } from "./MetricChart";
import { PreBaselineState } from "./PreBaselineState";

interface FullDashboardStoryProps {
  status: AutoresearchRunStatus;
  direction: AutoresearchDirection;
  iterationCount: number;
  maxIterations: number;
  baselineValue: number;
  changePerIteration: number;
  targetValue: number;
  showTarget: boolean;
  metricName: string;
  metricUnit: string;
  showResearch: boolean;
  showActivity: boolean;
  showContextUsage: boolean;
  contextUsed: number;
  contextSize: number;
  hypothesis: string;
  iterationPlan: string;
  approach: string;
}

// Fixed date: module-scope fixtures evaluate at import time, before the
// visual-regression clock freeze, so wall-clock times here would make the
// rendered Time column drift between snapshot runs.
const STORY_NOW = new Date("2026-07-01T10:30:00Z").getTime();
const STARTED_AT = STORY_NOW - 26 * 60_000;

function FullDashboardStory(props: FullDashboardStoryProps) {
  const run = buildRun(props);
  const events = buildEvents(props);
  const usage = props.showContextUsage
    ? {
        used: props.contextUsed,
        size: props.contextSize,
        percentage:
          props.contextSize > 0
            ? Math.round((props.contextUsed / props.contextSize) * 100)
            : 0,
        cost: null,
        breakdown: null,
      }
    : null;

  return (
    <div className="mx-auto min-h-screen max-w-[900px] bg-gray-1 p-5">
      <Flex direction="column" gap="4">
        <DashboardHeader run={run} />
        {run.iterations.length === 0 ? (
          <PreBaselineState
            run={run}
            sessionActivity={{
              status: "connected",
              isPromptPending: run.status === "running",
              isCompacting: false,
            }}
          />
        ) : (
          <>
            <RunStats run={run} />
            <MetricChart
              iterations={run.iterations}
              direction={run.config.direction}
              targetValue={run.config.targetValue}
              metricName={run.metricName ?? "the metric"}
              unit={run.metricUnit}
            />
            <IterationsTable
              iterations={run.iterations}
              direction={run.config.direction}
              unit={run.metricUnit}
            />
            {run.endedAt !== null && <RunSummary run={run} />}
          </>
        )}
        <AutoresearchRuntimeStats run={run} usage={usage} />
        <AutoresearchObservability run={run} events={events} />
      </Flex>
    </div>
  );
}

function DashboardHeader({ run }: { run: AutoresearchRun }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Text size="5" weight="bold">
            Autoresearch
          </Text>
          <Badge color="gray">{run.config.direction}</Badge>
          <Badge color={run.status === "running" ? "blue" : "gray"}>
            {run.status}
          </Badge>
        </div>
        <Text as="p" size="1" color="gray" className="mt-1">
          Agent is testing focused changes against{" "}
          {run.metricName ?? "the metric"}.
        </Text>
      </div>
      <div className="flex gap-2">
        <Button variant="soft" color="gray" disabled={run.status !== "running"}>
          Pause
        </Button>
        <Button variant="soft" color="red" disabled={run.endedAt !== null}>
          Stop
        </Button>
      </div>
    </div>
  );
}

function buildRun(props: FullDashboardStoryProps): AutoresearchRun {
  const ended =
    props.status === "completed" ||
    props.status === "stopped" ||
    props.status === "failed";
  return {
    id: "run-configurable-dashboard",
    config: {
      taskId: "task-1",
      direction: props.direction,
      targetValue: props.showTarget ? props.targetValue : null,
      maxIterations: props.maxIterations,
      implementModel: null,
      measureModel: null,
      implementEffort: null,
      measureEffort: null,
      instructions: `Optimize ${props.metricName}.`,
    },
    status: props.status,
    metricName: props.metricName,
    metricUnit: props.metricUnit || null,
    phase: null,
    originalModel: null,
    originalEffort: null,
    researchFindings: props.showResearch
      ? [
          {
            index: 1,
            area: "build",
            summary: "Located the measurement path",
            finding:
              "The metric can be reproduced from production build output.",
            nextStep: "Measure the baseline",
            at: STARTED_AT + 60_000,
          },
          {
            index: 2,
            area: "frontend",
            summary: "Mapped the eager dependency graph",
            finding: "Several modal modules load before the user opens them.",
            nextStep: "Test a lazy loading boundary",
            at: STARTED_AT + 3 * 60_000,
          },
        ]
      : [],
    iterations: buildIterations(props),
    startedAt: STARTED_AT,
    endedAt: ended ? STORY_NOW : null,
    endReason:
      props.status === "completed"
        ? "max-iterations"
        : props.status === "stopped"
          ? "stopped-by-user"
          : null,
    interruptedReason: props.status === "interrupted" ? "session-error" : null,
    lastError:
      props.status === "failed"
        ? "The agent stopped reporting the metric."
        : null,
  };
}

function buildIterations(
  props: FullDashboardStoryProps,
): AutoresearchIteration[] {
  let best: number | null = null;
  let previous: number | null = null;
  return Array.from({ length: props.iterationCount }, (_, offset) => {
    const index = offset + 1;
    const directionMultiplier = props.direction === "minimize" ? -1 : 1;
    const noise =
      offset > 0 && offset % 3 === 0 ? props.changePerIteration * -0.35 : 0;
    const value =
      props.baselineValue +
      directionMultiplier * props.changePerIteration * offset +
      noise;
    const improved =
      best === null ||
      (props.direction === "minimize" ? value < best : value > best);
    if (improved) best = value;
    const iteration: AutoresearchIteration = {
      index,
      value,
      bestValue: best ?? value,
      delta: previous === null ? null : value - previous,
      summary:
        index === 1
          ? "Established the baseline"
          : index % 3 === 1
            ? "Measured a regression and changed direction"
            : `Completed focused experiment ${index}`,
      hypothesis:
        index === 1
          ? "The baseline captures the current production behavior"
          : props.hypothesis,
      plan:
        index === 1
          ? "Run the reproducible baseline measurement"
          : props.iterationPlan,
      approach: index === 1 ? "baseline" : props.approach,
      at: STARTED_AT + index * 3 * 60_000,
    };
    previous = value;
    return iteration;
  });
}

function buildEvents(props: FullDashboardStoryProps): AcpMessage[] {
  if (!props.showActivity) return [];
  return [
    sessionEvent(STARTED_AT + 12 * 60_000, {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: `\`\`\`autoresearch\ntype: plan\nhypothesis: ${props.hypothesis}\nplan: ${props.iterationPlan}\napproach: ${props.approach}\n\`\`\``,
      },
    }),
    sessionEvent(STARTED_AT + 13 * 60_000, {
      sessionUpdate: "tool_call",
      title: "Search relevant modules",
      kind: "search",
      status: "completed",
    }),
    sessionEvent(STARTED_AT + 17 * 60_000, {
      sessionUpdate: "tool_call",
      title: "Edit the selected implementation",
      kind: "edit",
      status: "completed",
    }),
    sessionEvent(STARTED_AT + 22 * 60_000, {
      sessionUpdate: "tool_call",
      title: "Run the metric measurement",
      kind: "execute",
      status: props.status === "running" ? "in_progress" : "completed",
    }),
  ];
}

function sessionEvent(ts: number, update: Record<string, unknown>): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: { update },
    },
  } as AcpMessage;
}

const meta = {
  title: "Autoresearch/Configurable Full Dashboard",
  component: FullDashboardStory,
  parameters: { layout: "fullscreen" },
  argTypes: {
    status: {
      control: "select",
      options: [
        "running",
        "paused",
        "interrupted",
        "completed",
        "stopped",
        "failed",
      ],
    },
    direction: { control: "inline-radio", options: ["minimize", "maximize"] },
    iterationCount: { control: { type: "range", min: 0, max: 12, step: 1 } },
    maxIterations: { control: { type: "range", min: 1, max: 20, step: 1 } },
    baselineValue: { control: { type: "number", step: 10 } },
    changePerIteration: { control: { type: "number", step: 1 } },
    targetValue: { control: { type: "number", step: 10 } },
    contextUsed: { control: { type: "number", step: 1_000 } },
    contextSize: { control: { type: "number", step: 10_000 } },
  },
  args: {
    status: "running",
    direction: "minimize",
    iterationCount: 4,
    maxIterations: 10,
    baselineValue: 3850.7,
    changePerIteration: 145,
    targetValue: 3000,
    showTarget: true,
    metricName: "dashboard bundle",
    metricUnit: "KiB",
    showResearch: true,
    showActivity: true,
    showContextUsage: true,
    contextUsed: 175_000,
    contextSize: 1_000_000,
    hypothesis: "Eager modal imports dominate the dashboard entry bundle",
    iterationPlan:
      "Lazy load dashboard modals and rerun the production bundle measurement",
    approach: "code splitting",
  },
} satisfies Meta<typeof FullDashboardStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const BeforeBaseline: Story = {
  args: { iterationCount: 0, showResearch: true, status: "running" },
};

export const CompletedRun: Story = {
  args: { status: "completed", iterationCount: 8 },
};
