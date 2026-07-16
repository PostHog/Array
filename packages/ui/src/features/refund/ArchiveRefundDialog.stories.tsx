import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArchiveRefundDialog } from "./ArchiveRefundDialog";

/**
 * Archive and refund, combined into one honest flow. Click Archive, then
 * optionally tick "Also refund" to unfurl the gold panel — the confirm button
 * turns to gold and confirming celebrates with confetti and a coins-fly-back
 * flourish. Refund stays a deliberate opt-in, never confused with the primary
 * "use the product" CTAs.
 */
const meta: Meta<typeof ArchiveRefundDialog> = {
  title: "Components/Refund/ArchiveRefundDialog",
  component: ArchiveRefundDialog,
  parameters: { layout: "centered" },
  args: {
    amountLabel: "$4.20",
    // Pretend the network took a beat so the submitting state is visible.
    onArchive: () =>
      new Promise<void>((resolve) => window.setTimeout(resolve, 700)),
  },
  argTypes: {
    onArchive: { action: "archived" },
  },
};

export default meta;
type Story = StoryObj<typeof ArchiveRefundDialog>;

export const Default: Story = {};

export const NoAmount: Story = {
  args: { amountLabel: undefined },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const ArchiveFails: Story = {
  args: {
    onArchive: () =>
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
 * A single Archive button, not a second confusable Refund button beside it.
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
      <ArchiveRefundDialog {...args} />
      <button
        type="button"
        className="rounded bg-(--accent-9) px-2 py-1 text-sm text-white"
      >
        Open in GitHub
      </button>
    </div>
  ),
};
