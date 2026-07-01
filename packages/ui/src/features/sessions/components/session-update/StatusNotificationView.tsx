import { Spinner, XCircle } from "@phosphor-icons/react";
import { ChatMarker, ChatMarkerContent } from "@posthog/quill";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useChatThreadChrome } from "../chat-thread/chatThreadChrome";

interface StatusNotificationViewProps {
  status: string;
  isComplete?: boolean;
  /** Failure reason, set on a `compacting_failed` status. */
  error?: string;
}

export function StatusNotificationView({
  status,
  isComplete,
  error,
}: StatusNotificationViewProps) {
  // New thread renders status notes as centered separator markers; the legacy thread keeps its
  // bordered rows so ConversationView is unchanged when the chat thread is off.
  const chatChrome = useChatThreadChrome();

  // A failed compaction (e.g. "Not enough messages to compact"). The matching `compacting` spinner
  // is cleared separately; this row reports the outcome.
  if (status === "compacting_failed") {
    const message = error ? `Compacting failed: ${error}` : "Compacting failed";
    if (chatChrome) {
      return (
        <ChatMarker variant="separator">
          <ChatMarkerContent>{message}</ChatMarkerContent>
        </ChatMarker>
      );
    }
    return (
      <Box className="my-1 border-gray-6 border-l-2 py-1 pl-3 dark:border-gray-8">
        <Flex align="center" gap="2">
          <XCircle size={14} className="text-gray-9" />
          <Text className="text-[13px] text-gray-11">{message}</Text>
        </Flex>
      </Box>
    );
  }

  if (status === "compacting") {
    if (isComplete) {
      return null;
    }
    return (
      <Box className="my-1 border-blue-6 border-l-2 py-1 pl-3 dark:border-blue-8">
        <Flex align="center" gap="2">
          <Spinner size={14} className="animate-spin text-blue-9" />
          <Text className="text-[13px] text-gray-11">
            Compacting conversation history...
          </Text>
        </Flex>
      </Box>
    );
  }

  // Generic status display for other statuses
  return (
    <Box className="my-1 border-gray-6 border-l-2 py-1 pl-3 dark:border-gray-8">
      <Flex align="center" gap="2">
        <Text className="text-[13px] text-gray-11">Status: {status}</Text>
      </Flex>
    </Box>
  );
}
