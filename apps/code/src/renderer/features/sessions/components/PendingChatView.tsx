import type { UserMessageAttachment } from "@features/sessions/components/session-update/UserMessage";
import { CHAT_CONTENT_MAX_WIDTH } from "@features/sessions/constants";
import { Brain } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { PendingInputPlaceholder } from "./PendingInputPlaceholder";
import { UserMessage } from "./session-update/UserMessage";

interface PendingChatViewProps {
  promptText: string;
  attachments?: UserMessageAttachment[];
}

export function PendingChatView({
  promptText,
  attachments,
}: PendingChatViewProps) {
  return (
    <Flex direction="column" className="absolute inset-0 bg-background">
      <Box className="min-h-0 flex-1 overflow-y-auto">
        <Box
          className="mx-auto flex flex-col gap-3 px-2 py-1.5"
          style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
        >
          <UserMessage
            content={promptText}
            attachments={attachments}
            animate={false}
          />
          <Flex align="center" gap="2" className="pl-3">
            <Brain size={12} className="ph-pulse text-accent-11" />
            <Text className="text-[13px] text-accent-11">Starting task...</Text>
          </Flex>
        </Box>
      </Box>
      <Box
        className="mx-auto w-full p-2"
        style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
      >
        <PendingInputPlaceholder />
      </Box>
    </Flex>
  );
}
