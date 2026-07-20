import type { AutoresearchRun } from "@posthog/core/autoresearch/schemas";
import type { AcpMessage } from "@posthog/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AutoresearchObservability } from "./AutoresearchObservability";

const STARTED_AT = Date.parse("2026-07-10T14:00:00Z");
const MINUTE = 60_000;

const run: AutoresearchRun = {
  id: "run-observability",
  config: {
    taskId: "task-1",
    direction: "minimize",
    targetValue: 300,
    maxIterations: 10,
    implementModel: null,
    measureModel: null,
    implementEffort: null,
    measureEffort: null,
    instructions: "Reduce dashboard loading time.",
  },
  status: "running",
  metricName: "dashboard bundle",
  metricUnit: "KiB",
  phase: null,
  originalModel: null,
  originalEffort: null,
  researchFindings: [],
  iterations: [],
  startedAt: STARTED_AT,
  endedAt: STARTED_AT + 10 * 60_000,
  endReason: null,
  interruptedReason: null,
  lastError: null,
};

function event(ts: number, update: Record<string, unknown>): AcpMessage {
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

const events = [
  event(STARTED_AT + 30_000, {
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "text",
      text: "```autoresearch\ntype: plan\nhypothesis: eager modal imports dominate the dashboard entry bundle\nplan: lazy load dashboard modals and rerun the bundle measurement\napproach: code splitting\n```",
    },
  }),
  event(STARTED_AT + 60_000, {
    sessionUpdate: "tool_call",
    title: "Search dashboard imports",
    kind: "search",
    status: "completed",
  }),
  event(STARTED_AT + 3 * 60_000, {
    sessionUpdate: "tool_call",
    title: "Edit DashboardScene",
    kind: "edit",
    status: "completed",
  }),
  event(STARTED_AT + 7 * 60_000, {
    sessionUpdate: "tool_call",
    title: "Measure dashboard bundle",
    kind: "execute",
    status: "in_progress",
  }),
];

const meta: Meta<typeof AutoresearchObservability> = {
  title: "Autoresearch/Observability",
  component: AutoresearchObservability,
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[760px] p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AutoresearchObservability>;

export const ActiveExperiment: Story = { args: { run, events } };

export const WaitingForPlan: Story = {
  args: { run, events: [] },
  parameters: { testOptions: { waitForLoadersToDisappear: false } },
};

export const AllActivityKinds: Story = {
  args: {
    run: {
      ...run,
      status: "completed",
      endedAt: STARTED_AT + 12 * MINUTE,
    },
    events: [
      event(STARTED_AT + 30_000, {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "```autoresearch\ntype: plan\nhypothesis: eager modal imports dominate the dashboard entry bundle\nplan: lazy load dashboard modals and rerun the bundle measurement\napproach: code splitting\n```",
        },
      }),
      event(STARTED_AT + MINUTE, {
        sessionUpdate: "tool_call",
        toolCallId: "reasoning",
        title: "Compare possible optimization approaches",
        kind: "think",
        status: "completed",
      }),
      event(STARTED_AT + 2 * MINUTE, {
        sessionUpdate: "tool_call",
        toolCallId: "research",
        title: "Search dashboard imports",
        kind: "search",
        status: "completed",
      }),
      event(STARTED_AT + 4 * MINUTE, {
        sessionUpdate: "tool_call",
        toolCallId: "implementation",
        title: "Edit DashboardScene",
        kind: "edit",
        status: "completed",
      }),
      event(STARTED_AT + 7 * MINUTE, {
        sessionUpdate: "tool_call",
        toolCallId: "measurement",
        title: "Run tests",
        kind: "execute",
        rawInput: { command: "pnpm test --filter dashboard" },
        status: "completed",
      }),
      event(STARTED_AT + 10 * MINUTE, {
        sessionUpdate: "tool_call",
        toolCallId: "execution",
        title: "Start preview server",
        kind: "execute",
        rawInput: { command: "pnpm dev:code" },
        status: "completed",
      }),
    ],
  },
};

function ConcurrentCommandsStory() {
  const startedAt = Date.now() - 10 * MINUTE;
  return (
    <AutoresearchObservability
      run={{ ...run, startedAt, endedAt: null }}
      events={[
        event(startedAt + 2 * MINUTE, {
          sessionUpdate: "tool_call",
          toolCallId: "server",
          title: "Start Storybook dev server",
          kind: "execute",
          rawInput: { command: "pnpm --filter code storybook" },
          status: "in_progress",
        }),
        event(startedAt + 5 * MINUTE, {
          sessionUpdate: "tool_call",
          toolCallId: "benchmark",
          title: "Run bundle benchmark",
          kind: "execute",
          rawInput: { command: "pnpm bench:dashboard" },
          status: "in_progress",
        }),
        event(startedAt + 8 * MINUTE, {
          sessionUpdate: "tool_call",
          toolCallId: "status",
          title: "Check repository status",
          kind: "execute",
          rawInput: { command: "git status --short" },
          status: "completed",
        }),
      ]}
    />
  );
}

export const ConcurrentCommands: Story = {
  args: { run, events: [] },
  render: () => <ConcurrentCommandsStory />,
};

export const LongCommandLabels: Story = {
  args: {
    run: {
      ...run,
      status: "completed",
      endedAt: STARTED_AT + 6 * MINUTE,
    },
    events: [
      event(STARTED_AT + MINUTE, {
        sessionUpdate: "tool_call",
        toolCallId: "long-command",
        title: "Run command",
        kind: "execute",
        rawInput: {
          command:
            "pnpm --filter @posthog/code test -- --runInBand packages/ui/src/features/autoresearch/AutoresearchObservability.test.tsx",
        },
        status: "completed",
      }),
      event(STARTED_AT + 4 * MINUTE, {
        sessionUpdate: "tool_call",
        toolCallId: "long-research",
        title:
          "Inspect every dashboard import that contributes to the production entry bundle",
        kind: "search",
        status: "completed",
      }),
    ],
  },
};

export const CompletedTimeline: Story = {
  args: {
    run: {
      ...run,
      status: "completed",
      endedAt: STARTED_AT + 9 * MINUTE,
    },
    events,
  },
};

export const EmptyCompletedTimeline: Story = {
  args: {
    run: {
      ...run,
      status: "completed",
      endedAt: STARTED_AT + 2 * MINUTE,
    },
    events: [],
  },
};
