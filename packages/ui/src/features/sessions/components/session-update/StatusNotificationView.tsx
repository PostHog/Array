import {
  ArrowsClockwise,
  ShieldWarning,
  Spinner,
  XCircle,
} from "@phosphor-icons/react";
import { ChatMarker, ChatMarkerContent } from "@posthog/quill";
import { Box, Callout, Flex, Text } from "@radix-ui/themes";
import { useChatThreadChrome } from "../chat-thread/chatThreadChrome";

interface StatusNotificationViewProps {
  status: string;
  isComplete?: boolean;
  /** Failure reason, set on a `compacting_failed` status. */
  error?: string;
  /** Refusal statuses: display-only stop_details.explanation from the API. */
  explanation?: string;
  /** Refusal fallback: the model that declined the request. */
  fromModel?: string;
  /** Refusal fallback: the model that retried the request. */
  toModel?: string;
}

export function StatusNotificationView({
  status,
  isComplete,
  error,
  explanation,
  fromModel,
  toModel,
}: StatusNotificationViewProps) {
  // New thread renders status notes as centered separator markers; the legacy thread keeps its
  // bordered rows so ConversationView is unchanged when the chat thread is off.
  const chatChrome = useChatThreadChrome();

  // Terminal refusal: the safety classifier declined the request and no
  // fallback model rescued it. Rendered as a callout in both chromes.
  if (status === "refusal") {
    return (
      <Box className="my-2">
        <Callout.Root color="orange" size="1">
          <Callout.Icon>
            <ShieldWarning weight="fill" />
          </Callout.Icon>
          <Callout.Text>
            <Flex direction="column" gap="1">
              <Text className="font-medium text-sm">
                Claude declined to continue with this request.
              </Text>
              {explanation && (
                <Text className="text-[13px] text-gray-11">{explanation}</Text>
              )}
              <Text className="text-[13px] text-gray-11">
                Try rephrasing your request, or switch models and retry.
              </Text>
            </Flex>
          </Callout.Text>
        </Callout.Root>
      </Box>
    );
  }

  if (status === "refusal_fallback") {
    const message =
      fromModel && toModel
        ? `${fromModel} declined this request, retried with ${toModel}`
        : "Request declined, retried with the fallback model";
    if (chatChrome) {
      return (
        <ChatMarker variant="separator">
          <ChatMarkerContent>{message}</ChatMarkerContent>
        </ChatMarker>
      );
    }
    return (
      <Box className="my-1 border-orange-6 border-l-2 py-1 pl-3 dark:border-orange-8">
        <Flex align="center" gap="2">
          <ArrowsClockwise size={14} className="text-orange-9" />
          <Text className="text-[13px] text-gray-11">{message}</Text>
        </Flex>
      </Box>
    );
  }

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
