import {
  ArrowBendDownLeft,
  ArrowUUpLeft,
  Stack,
  Trash,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Box, Flex, IconButton, Tooltip } from "@radix-ui/themes";
import { MarkdownRenderer } from "../../../editor/components/MarkdownRenderer";
import type { QueuedMessage } from "../../sessionStore";
import { hasFileMentions, parseFileMentions } from "./parseFileMentions";

interface QueuedMessageViewProps {
  message: QueuedMessage;
  onSteer?: () => void;
  onReturnToEditor?: () => void;
  onRemove?: () => void;
  supportsNativeSteer?: boolean;
}

export function QueuedMessageView({
  message,
  onSteer,
  onReturnToEditor,
  onRemove,
  supportsNativeSteer = false,
}: QueuedMessageViewProps) {
  const steerTooltip = supportsNativeSteer
    ? "Inject this message into the current turn at the next tool boundary."
    : "Interrupt the current turn and resend with this message.";

  return (
    <Box className="rounded-lg border border-gray-5 bg-card px-3 py-2">
      <Flex align="center" gap="2">
        <Stack size={14} className="shrink-0 text-gray-9" />
        <Box className="min-w-0 flex-1 font-medium text-[13px] text-gray-12 [&>*:last-child]:mb-0">
          {hasFileMentions(message.content) ? (
            parseFileMentions(message.content)
          ) : (
            <MarkdownRenderer content={message.content} />
          )}
        </Box>
        <Flex align="center" gap="1" className="shrink-0">
          {onSteer && (
            <Tooltip content={steerTooltip}>
              <Button
                type="button"
                variant="default"
                size="sm"
                aria-label="Steer this message"
                onClick={onSteer}
              >
                <ArrowBendDownLeft size={12} />
                <span>Steer</span>
              </Button>
            </Tooltip>
          )}
          {onReturnToEditor && (
            <Tooltip content="Return to editor">
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                aria-label="Return to editor"
                onClick={onReturnToEditor}
              >
                <ArrowUUpLeft size={12} />
              </IconButton>
            </Tooltip>
          )}
          {onRemove && (
            <Tooltip content="Discard">
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                aria-label="Discard queued message"
                onClick={onRemove}
              >
                <Trash size={12} />
              </IconButton>
            </Tooltip>
          )}
        </Flex>
      </Flex>
    </Box>
  );
}
