import { GeneralSettings } from "@posthog/ui/features/settings/sections/GeneralSettings";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta<typeof GeneralSettings> = {
  title: "Settings/GeneralSettings",
  component: GeneralSettings,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl p-6">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof GeneralSettings>;

export const Default: Story = {};
