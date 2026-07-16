import type { Meta, StoryObj } from "@storybook/react-vite";
import { RefundButton } from "./RefundButton";

/**
 * The refund action, made to feel good rather than punitive. Hover to catch the
 * gold sheen and coin flip; confirm to celebrate an honest refund with a
 * coins-flying-back flourish. Styled apart from the primary CTAs on purpose so
 * "refund" never reads as "use the product".
 */
const meta: Meta<typeof RefundButton> = {
  title: "Components/Refund/RefundButton",
  component: RefundButton,
  parameters: { layout: "centered" },
  args: {
    amountLabel: "$4.20",
    // Pretend the network took a beat so the "Refunding…" state is visible.
    onRefund: () =>
      new Promise<void>((resolve) => window.setTimeout(resolve, 700)),
  },
  argTypes: {
    onRefund: { action: "refunded" },
  },
};

export default meta;
type Story = StoryObj<typeof RefundButton>;

export const Default: Story = {};

export const NoAmount: Story = {
  args: { amountLabel: undefined },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const RefundFails: Story = {
  args: {
    onRefund: () =>
      new Promise<void>((_, reject) =>
        window.setTimeout(
          () => reject(new Error("Payment provider declined the refund")),
          700,
        ),
      ),
  },
};

/**
 * How it sits next to the other review-bar actions — the point of the thread.
 * Refund reads as its own, warmer thing beside the neutral/primary buttons.
 */
export const InAReviewBar: Story = {
  render: (args) => (
    <div className="flex items-center gap-1 rounded-md border border-(--gray-6) bg-(--color-panel-solid) p-2">
      <button
        type="button"
        className="rounded px-2 py-1 text-(--gray-11) text-sm hover:bg-(--gray-3)"
      >
        Discuss
      </button>
      <RefundButton {...args} />
      <button
        type="button"
        className="rounded bg-(--accent-9) px-2 py-1 text-sm text-white"
      >
        Open in GitHub
      </button>
    </div>
  ),
};
