import { CHAT_CONTENT_MAX_WIDTH } from "@posthog/ui/features/sessions/constants";
import { Box, Flex, Text } from "@radix-ui/themes";
import type { Meta, StoryObj } from "@storybook/react";
import { StaleConversationCostNotice } from "./StaleConversationCostNotice";

const meta: Meta<typeof StaleConversationCostNotice> = {
  title: "Sessions/StaleConversationCostNotice",
  component: StaleConversationCostNotice,
  decorators: [
    (Story) => (
      <Flex direction="column" className="h-[560px] w-full bg-background">
        <FakeConversation />
        <Box
          className="mx-auto w-full px-2 pb-3"
          style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
        >
          <Story />
        </Box>
      </Flex>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof StaleConversationCostNotice>;

/** Stand-in chat content so the notice sits below a thread, like the composer. */
function FakeConversation() {
  return (
    <Flex direction="column" gap="3" p="4" className="flex-1 overflow-hidden">
      {[
        "Investigate detached element memory leaks",
        "Ran 3 commands, 1 subagent",
        "Review posted. Now the sticky summary comment:",
        "Pushed and in sync. Now the simplify pass on this HEAD:",
        "1 subagent - simplify pass on 68452",
      ].map((line) => (
        <Box key={line} p="3" className="rounded-2 bg-gray-2">
          <Text color="gray" className="text-sm">
            {line}
          </Text>
        </Box>
      ))}
    </Flex>
  );
}

const TWO_HOURS_AGO = Date.now() - 2 * 60 * 60 * 1000;

export const Default: Story = {
  args: {
    usedTokens: 481_000,
    lastActivityAt: TWO_HOURS_AGO,
    costUsd: 12.34,
    onContinue: () => {},
    onCompact: () => {},
    onNewSession: () => {},
  },
};

export const WithoutNewSessionOrCost: Story = {
  args: {
    usedTokens: 128_000,
    lastActivityAt: TWO_HOURS_AGO,
    costUsd: null,
    onContinue: () => {},
    onCompact: () => {},
  },
};
