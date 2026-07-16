import { UsageMeter } from "@posthog/ui/features/billing/UsageMeter";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta<typeof UsageMeter> = {
  title: "Billing/UsageMeter",
  component: UsageMeter,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 560 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof UsageMeter>;

// A subscribed org on default settings: the $70 limit is $20 included
// allowance + the $50 default spend limit, spelled out in the detail line
// with the notch marking where the included allowance ends.
export const SubscribedWithBreakdown: Story = {
  args: {
    label: "Usage this period",
    percent: 18,
    valueLabel: "$12.40 of $70",
    detail: "$20 included + $50 org spend limit. Resets Jul 31 at 2:00 PM PDT",
    markerPercent: (20 / 70) * 100,
  },
};

export const SubscribedPastIncluded: Story = {
  args: {
    label: "Usage this period",
    percent: 66,
    valueLabel: "$46.20 of $70",
    detail: "$20 included + $50 org spend limit. Resets Jul 31 at 2:00 PM PDT",
    markerPercent: (20 / 70) * 100,
  },
};

export const FreeTier: Story = {
  args: {
    label: "Monthly free usage",
    percent: 62,
    valueLabel: "$12.40 of $20 included",
    detail: "Resets Jul 31 at 2:00 PM PDT",
  },
};

export const Exceeded: Story = {
  args: {
    label: "Usage this period",
    percent: 100,
    valueLabel: "$70 of $70",
    detail:
      "Limit exceeded. $20 included + $50 org spend limit. Resets Jul 31 at 2:00 PM PDT",
    markerPercent: (20 / 70) * 100,
    color: "red",
  },
};
