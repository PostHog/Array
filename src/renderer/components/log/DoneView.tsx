import {
  CaretRight as CaretRightIcon,
  Check as CheckIcon,
} from "@phosphor-icons/react";
import type { AgentEvent } from "@posthog/agent";
import { Box, Code } from "@radix-ui/themes";
import { MarkdownRenderer } from "../MarkdownRenderer";

interface DoneViewProps {
  event: Extract<AgentEvent, { type: "done" }>;
}

function formatDuration(ms?: number): string {
  if (!ms) return "unknown";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function DoneView({ event }: DoneViewProps) {
  // If there's no result or meaningful content, skip rendering (likely an intermediate stage completion)
  const hasContent =
    event.result ||
    (event.permissionDenials && event.permissionDenials.length > 0) ||
    (event.numTurns !== undefined && event.numTurns > 0);

  if (!hasContent) {
    return null;
  }

  return (
    <Box mb="3">
      <Box className="overflow-hidden rounded-3 border border-gray-6">
        <Box className="flex cursor-default items-center gap-2 border-gray-6 border-b bg-gray-2 px-3 py-2">
          <Box
            style={{
              display: "flex",
              alignItems: "center",
              opacity: 0,
            }}
          >
            <CaretRightIcon size={14} />
          </Box>
          <Box
            style={{
              display: "flex",
              alignItems: "center",
              color: "var(--green-11)",
            }}
          >
            <CheckIcon size={14} weight="bold" />
          </Box>
          <Code
            size="2"
            variant="ghost"
            style={{ display: "flex", alignItems: "center" }}
          >
            Task Completed
          </Code>
          {(event.durationMs !== undefined || event.numTurns !== undefined) && (
            <Code
              size="1"
              color="gray"
              variant="ghost"
              style={{
                display: "flex",
                alignItems: "center",
                marginLeft: "auto",
              }}
            >
              {formatDuration(event.durationMs)}
              {event.numTurns !== undefined && ` • ${event.numTurns} turns`}
              {event.totalCostUsd !== undefined &&
                event.totalCostUsd > 0 &&
                ` • $${event.totalCostUsd.toFixed(4)}`}
            </Code>
          )}
        </Box>
        <Box className="p-3">
          {event.result && (
            <Box>
              <MarkdownRenderer content={event.result} />
            </Box>
          )}
          {event.permissionDenials && event.permissionDenials.length > 0 && (
            <Box mt={event.result ? "2" : "0"}>
              <Code size="1" color="orange" variant="soft">
                {event.permissionDenials.length} tool call(s) denied by
                permissions
              </Code>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
