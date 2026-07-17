import type { Task, UserBasic } from "@posthog/shared/domain-types";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskFeedRow } from "./ChannelFeedView";

// A stand-in for the real TaskCard, which fetches its own status/PR data and so
// renders empty in Storybook. The story only needs something card-shaped under
// the attribution for the row to read realistically.
function MockTaskCard({ title }: { title: string }) {
  return (
    <div className="mt-1.5 rounded-sm border border-border-primary px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{title}</span>
        <span className="rounded-full bg-fill-secondary px-2 py-0.5 text-muted-foreground text-xs">
          Ready
        </span>
      </div>
    </div>
  );
}

const user = (overrides: Partial<UserBasic> = {}): UserBasic => ({
  id: 1,
  uuid: "user-1",
  email: "adam@posthog.com",
  first_name: "Adam",
  last_name: "Bowker",
  ...overrides,
});

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  task_number: 1,
  slug: "task-1",
  title: "Add feedback modal to channels view",
  description: "",
  // A fixed timestamp keeps the relative-time label stable for visual review.
  created_at: "2026-07-17T12:00:00.000Z",
  updated_at: "2026-07-17T12:00:00.000Z",
  origin_product: "user_created",
  created_by: user(),
  ...overrides,
});

const meta: Meta<typeof TaskFeedRow> = {
  title: "Channels/TaskFeedRow",
  component: TaskFeedRow,
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TaskFeedRow>;

/**
 * A channel-started task, attributed to the human who started it: initials
 * avatar, their display name, no "Agent" badge, and a plain "started a new
 * task" body.
 */
export const HumanStarted: Story = {
  args: {
    task: task(),
    children: <MockTaskCard title="Add feedback modal to channels view" />,
  },
};

/**
 * A human with no name set falls back to the email-derived initials in the
 * avatar and the email as the display name.
 */
export const HumanEmailOnly: Story = {
  args: {
    task: task({
      created_by: user({ first_name: undefined, last_name: undefined }),
    }),
    children: <MockTaskCard title="Make background color configurable" />,
  },
};

/**
 * A non-user origin (e.g. Slack) stays agent-attributed — robot avatar,
 * "PostHog" name, "Agent" badge — even though created_by is set, because that
 * person didn't start the task in the channel.
 */
export const AgentOrigin: Story = {
  args: {
    task: task({
      origin_product: "slack",
      title: "Investigate signup drop-off",
    }),
    children: <MockTaskCard title="Investigate signup drop-off" />,
  },
};

/**
 * A user_created task with no created_by has no human to attribute, so it also
 * falls back to the agent identity.
 */
export const NoStarter: Story = {
  args: {
    task: task({ created_by: null, title: "Untitled task" }),
    children: <MockTaskCard title="Untitled task" />,
  },
};
