import { CHAT_CONTENT_MAX_WIDTH } from "@features/sessions/constants";
import { Spinner } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { UserMessage } from "./session-update/UserMessage";

interface PendingChatViewProps {
  promptText: string;
  /** Render inside an existing positioned container — skip the absolute fill wrapper. */
  embedded?: boolean;
}

export function PendingChatView({
  promptText,
  embedded = false,
}: PendingChatViewProps) {
  const content = (
    <Flex direction="column" className="h-full w-full bg-background">
      <Box className="min-h-0 flex-1 overflow-y-auto">
        <Box
          className="mx-auto px-2 py-1.5"
          style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
        >
          <UserMessage content={promptText} animate={false} />
        </Box>
      </Box>
      <Box className="relative min-h-[66px] border-gray-4 border-t">
        <Flex
          align="center"
          justify="center"
          gap="2"
          className="absolute inset-0"
        >
          <Spinner size={28} className="animate-spin text-gray-9" />
          <Text color="gray" className="text-base">
            Connecting to agent...
          </Text>
        </Flex>
      </Box>
    </Flex>
  );

  if (embedded) {
    return <Box className="absolute inset-0">{content}</Box>;
  }

  return content;
}
