import type { AutoresearchRun } from "@posthog/core/autoresearch/schemas";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PreBaselineState } from "./PreBaselineState";

const run: AutoresearchRun = {
  id: "run-research",
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
  status: "running",
  metricName: null,
  metricUnit: null,
  phase: null,
  originalModel: null,
  originalEffort: null,
  researchFindings: [
    {
      index: 1,
      area: "build",
      summary: "Located the production bundle measurement",
      finding:
        "The dashboard marginal bundle can be isolated from esbuild metadata.",
      nextStep: "Establish the baseline bundle size",
      at: 1,
    },
    {
      index: 2,
      area: "frontend",
      summary: "Mapped eager dashboard imports",
      finding: "Dashboard modals load before users open them.",
      nextStep: "Inspect modal boundaries",
      at: 2,
    },
  ],
  iterations: [],
  startedAt: Date.parse("2026-07-10T14:00:00Z"),
  endedAt: null,
  endReason: null,
  interruptedReason: null,
  lastError: null,
};

const meta: Meta<typeof PreBaselineState> = {
  title: "Autoresearch/Research Map",
  component: PreBaselineState,
};

export default meta;
type Story = StoryObj<typeof PreBaselineState>;

export const FindingsByCodeArea: Story = {
  args: {
    run,
    sessionActivity: {
      status: "connected",
      isPromptPending: true,
      isCompacting: false,
    },
  },
};

export const EstablishingBaseline: Story = {
  args: {
    run: { ...run, researchFindings: [] },
    sessionActivity: {
      status: "connected",
      isPromptPending: true,
      isCompacting: false,
    },
  },
};
