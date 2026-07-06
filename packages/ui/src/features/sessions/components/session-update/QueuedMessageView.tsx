import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowBendDownLeft,
  CaretDown,
  PencilSimple,
  Stack,
  Trash,
} from "@phosphor-icons/react";
import { Button, cn } from "@posthog/quill";
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

  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  // Only meaningful while collapsed: expanding removes the clamp so scrollHeight === clientHeight.
  // We keep the prior result when expanded so the "Show less" trigger stays put.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the message text changes.
  useLayoutEffect(() => {
    if (isExpanded) return;
    const el = textRef.current;
    if (!el) return;
    const measure = () =>
      setIsOverflowing(el.scrollHeight - el.clientHeight > 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [message.content, isExpanded]);

  return (
    <Box className="rounded-lg border border-gray-5 bg-card px-3 py-2">
      <Flex align="start" gap="2">
        <Stack size={14} className="shrink-0 text-gray-9 mt-0.5" />
        <Box className="min-w-0 flex-1 font-medium text-[13px] text-gray-12 [&>*:last-child]:mb-0">
          <div
            ref={textRef}
            className={cn(
              !isExpanded && "max-h-[3lh] overflow-hidden",
              !isExpanded &&
                isOverflowing &&
                "[mask-image:linear-gradient(to_bottom,black_45%,transparent)]",
            )}
          >
            {hasFileMentions(message.content) ? (
              parseFileMentions(message.content)
            ) : (
              <MarkdownRenderer content={message.content} />
            )}
          </div>
          {isOverflowing && (
            <button
              type="button"
              onClick={() => setIsExpanded((v) => !v)}
              className="mt-1 flex items-center gap-0.5 text-muted-foreground text-xs hover:text-foreground"
            >
              Show {isExpanded ? "less" : "more"}
              <CaretDown
                className={cn("size-3", isExpanded && "rotate-180")}
              />
            </button>
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
                <PencilSimple size={12} />
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
