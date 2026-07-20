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
      area: "build",
      summary: "Found the dashboard entry chunk",
      finding:
        "The route entry includes editor and modal code before either feature is opened.",
      nextStep: "Compare the entry chunk with lazy boundaries enabled",
      at: 2,
    },
    {
      index: 3,
      area: "frontend",
      summary: "Mapped eager dashboard imports",
      finding: "Dashboard modals load before users open them.",
      nextStep: "Inspect modal boundaries",
      at: 3,
    },
    {
      index: 4,
      area: "frontend",
      summary: "Traced editor initialization",
      finding:
        "The rich text editor initializes with the dashboard even when no editor is visible.",
      nextStep: "Move editor setup behind the edit action",
      at: 4,
    },
    {
      index: 5,
      area: "data",
      summary: "Identified duplicate insight requests",
      finding:
        "The summary and chart issue equivalent requests during the first render.",
      nextStep: "Share the initial query result",
      at: 5,
    },
    {
      index: 6,
      area: "data",
      summary: "Measured oversized response fields",
      finding:
        "Dashboard cards receive metadata that is only needed in the detail view.",
      nextStep: "Select the minimal card response shape",
      at: 6,
    },
    {
      index: 7,
      area: "testing",
      summary: "Located the bundle regression test",
      finding:
        "The current threshold covers the full application instead of the dashboard entry.",
      nextStep: "Add a dashboard-specific bundle assertion",
      at: 7,
    },
    {
      index: 8,
      area: "testing",
      summary: "Confirmed a stable measurement command",
      finding:
        "The production build emits deterministic metadata for the dashboard chunk.",
      nextStep: "Establish the baseline bundle size",
      at: 8,
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
  parameters: { testOptions: { waitForLoadersToDisappear: false } },
  decorators: [
    (Story) => (
      <div className="@container">
        <Story />
      </div>
    ),
  ],
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
  parameters: { testOptions: { viewport: { width: 1280, height: 1200 } } },
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
