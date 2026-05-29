import { Clock, X } from "@phosphor-icons/react";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { MarkdownRenderer } from "../../../editor/components/MarkdownRenderer";
import type { QueuedMessage } from "../../sessionStore";
import { hasFileMentions, parseFileMentions } from "./parseFileMentions";

interface QueuedMessageViewProps {
  message: QueuedMessage;
  onRemove?: () => void;
}

export function QueuedMessageView({
  message,
  onRemove,
}: QueuedMessageViewProps) {
  return (
    <Box
      className="group relative border-l-2 border-dashed bg-gray-2 py-2 pr-2 pl-3 opacity-70"
      style={{ borderColor: "var(--gray-8)" }}
    >
      <Flex justify="between" align="start" gap="2">
        <Box className="min-w-0 flex-1 font-medium text-[13px] [&>*:last-child]:mb-0">
          {hasFileMentions(message.content) ? (
            parseFileMentions(message.content)
          ) : (
            <MarkdownRenderer content={message.content} />
          )}
        </Box>
        {onRemove && (
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            className="shrink-0 opacity-0 group-hover:opacity-100"
            onClick={onRemove}
          >
            <X size={12} />
          </IconButton>
        )}
      </Flex>
      <Flex align="center" gap="1" mt="1">
        <Clock size={12} className="text-gray-9" />
        <Text color="gray" className="text-[13px]">
          Queued
        </Text>
      </Flex>
    </Box>
  );
}
