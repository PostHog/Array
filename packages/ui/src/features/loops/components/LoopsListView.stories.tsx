import type { LoopSchemas } from "@posthog/api-client/loops";
import type { UserBasic } from "@posthog/shared/domain-types";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoopsListViewPresentation } from "./LoopsListView";

const VINCENT: UserBasic = {
  id: 2,
  uuid: "user-vincent",
  email: "vincent@example.com",
  first_name: "Vincent",
  last_name: "Ge",
};

const PAUL: UserBasic = {
  id: 3,
  uuid: "user-paul",
  email: "paul@example.com",
  first_name: "Paul",
  last_name: "Bean",
};

function notifications(
  enabled: Array<keyof LoopSchemas.LoopNotifications>,
  slackChannel = "loops-alerts",
): LoopSchemas.LoopNotifications {
  const events: LoopSchemas.LoopNotificationEventEnum[] = [
    "run_completed",
    "run_failed",
  ];
  return {
    push: { enabled: enabled.includes("push"), events, params: {} },
    email: { enabled: enabled.includes("email"), events, params: {} },
    slack: {
      enabled: enabled.includes("slack"),
      events,
      params: { channel_id: "C012345", channel_name: slackChannel },
    },
  };
}

function loop(
  id: string,
  overrides: Partial<LoopSchemas.Loop> = {},
): LoopSchemas.Loop {
  const visibility = overrides.visibility ?? "personal";
  const createdById = visibility === "personal" ? 1 : VINCENT.id;
  return {
    id,
    team_id: 2,
    created_by_id: createdById,
    name: `Loop ${id}`,
    description: "",
    visibility,
    instructions: "Review recent activity and report anything notable.",
    runtime_adapter: "claude",
    model: "claude-sonnet-4-5",
    reasoning_effort: null,
    repositories: [],
    sandbox_environment_id: null,
    enabled: true,
    disabled_reason: null,
    overlap_policy: "skip",
    behaviors: {
      create_prs: false,
      watch_ci: false,
      fix_review_comments: false,
      max_fix_iterations: 3,
    },
    connectors: { mcp_installation_ids: [], posthog_mcp_scopes: "read_only" },
    notifications: notifications([]),
    context_target: null,
    internal: false,
    origin_product: "user_created",
    last_run_at: null,
    last_run_status: null,
    last_error: null,
    consecutive_failures: 0,
    created_at: "2026-07-20T12:00:00Z",
    updated_at: "2026-07-20T12:00:00Z",
    triggers: [
      {
        id: `trigger-${id}`,
        loop_id: id,
        type: "schedule",
        enabled: true,
        config: { cron_expression: "0 9 * * 1-5", timezone: "UTC" },
        schedule_sync_status: "synced",
        last_fired_at: null,
        created_at: "2026-07-20T12:00:00Z",
        updated_at: "2026-07-20T12:00:00Z",
      },
    ],
    ...overrides,
  };
}

const MIXED_LOOPS: LoopSchemas.Loop[] = [
  loop("personal-push", {
    name: "Daily product pulse",
    notifications: notifications(["push"]),
  }),
  loop("personal-email", {
    name: "Weekly account summary",
    notifications: notifications(["email"]),
  }),
  loop("team-slack", {
    name: "Agentic-detection rollout monitoring",
    visibility: "team",
    notifications: notifications(["slack"], "agentic-rollout"),
  }),
  loop("team-all", {
    name: "Production incident watch",
    visibility: "team",
    created_by_id: PAUL.id,
    notifications: notifications(["push", "email", "slack"], "incidents"),
  }),
];

const meta: Meta<typeof LoopsListViewPresentation> = {
  title: "Loops/LoopsListView",
  component: LoopsListViewPresentation,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-screen w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    loops: MIXED_LOOPS,
    members: [VINCENT, PAUL],
    onStartBlank: () => {},
    onStartFromTemplate: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof LoopsListViewPresentation>;

export const MixedNotifications: Story = {};

export const LongContent: Story = {
  args: {
    loops: [
      loop("long-personal", {
        name: "A very long personal loop name that tests truncation without displacing status badges or navigation",
        description:
          "This description is intentionally long so notification and creator metadata remain visible on their own line while the descriptive copy truncates independently.",
        notifications: notifications(["push", "email"]),
      }),
      loop("long-team", {
        name: "Monitor every production deployment and correlate regressions across all customer-facing services",
        description:
          "Checks deployments, error rates, session replay signals, support volume, and conversion changes before posting a concise summary for the team.",
        visibility: "team",
        notifications: notifications(["push", "email", "slack"]),
      }),
    ],
  },
};

export const LongMixedList: Story = {
  args: {
    loops: Array.from({ length: 18 }, (_, index) => {
      const visibility = index % 3 === 0 ? "team" : "personal";
      const channels: Array<keyof LoopSchemas.LoopNotifications> = [];
      if (index % 2 === 0) channels.push("push");
      if (index % 4 === 0) channels.push("email");
      if (index % 3 === 0) channels.push("slack");
      return loop(`long-list-${index + 1}`, {
        name: `Loop ${String(index + 1).padStart(2, "0")} · ${index % 2 === 0 ? "Monitor product health" : "Summarize customer feedback"}`,
        visibility,
        created_by_id: visibility === "team" ? VINCENT.id : 1,
        enabled: index % 7 !== 0,
        notifications: notifications(channels, `team-loop-${index + 1}`),
      });
    }),
  },
};

export const CreatorStates: Story = {
  args: {
    loops: [
      loop("personal-owner", { name: "Personal loop" }),
      loop("known-owner", {
        name: "Known team creator",
        visibility: "team",
      }),
      loop("former-owner", {
        name: "Former organization member",
        visibility: "team",
        created_by_id: 999,
      }),
    ],
  },
};

export const CreatorLoading: Story = {
  args: { members: [], membersLoading: true },
};

export const CreatorUnavailable: Story = {
  args: { members: [], membersError: true },
};

export const Empty: Story = { args: { loops: [] } };

export const Loading: Story = { args: { loops: [], isLoading: true } };

export const LoadError: Story = {
  args: { loops: [], error: new Error("Loops could not be loaded") },
};
