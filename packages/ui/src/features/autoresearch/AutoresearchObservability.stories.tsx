import type { AutoresearchRun } from "@posthog/core/autoresearch/schemas";
import type { AcpMessage } from "@posthog/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AutoresearchObservability } from "./AutoresearchObservability";

const STARTED_AT = Date.parse("2026-07-10T14:00:00Z");

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

export const WaitingForPlan: Story = { args: { run, events: [] } };
