import { ArtifactView } from "@features/logs/components/ArtifactView";
import { BaseLogEntry } from "@features/logs/components/BaseLogEntry";
import { DoneView } from "@features/logs/components/DoneView";
import { ErrorView } from "@features/logs/components/ErrorView";
import { InitView } from "@features/logs/components/InitView";
import { MetricEventView } from "@features/logs/components/MetricEventView";
import { ProgressView } from "@features/logs/components/ProgressView";
import { StatusView } from "@features/logs/components/StatusView";
import { TokenView } from "@features/logs/components/TokenView";
import { ToolExecutionView } from "@features/logs/components/ToolExecutionView";
import { UserMessageView } from "@features/logs/components/UserMessageView";
import type { AgentEvent } from "@posthog/agent";
import { Code, ContextMenu } from "@radix-ui/themes";
import { IS_DEV } from "@shared/constants/environment";

const EVENT_COMPONENT_MAP: Record<
  string,
  React.ComponentType<{ event: any }>
> = {
  token: TokenView,
  text: TokenView, // Legacy: treat "text" events like "token" events
  status: StatusView,
  error: ErrorView,
  done: DoneView,
  user_message: UserMessageView,
  init: InitView,
  artifact: ArtifactView,
  metric: MetricEventView,
  progress: ProgressView,
};

const SKIP_EVENTS = [
  "content_block_start",
  "content_block_stop",
  "message_start",
  "message_stop",
  "message_delta",
  "compact_boundary",
  "raw_sdk_event",
  "tool_result", // Skip tool_result - handled by ToolExecutionView
];

interface LogEventRendererProps {
  event: AgentEvent;
  index: number;
  toolResult?: Extract<AgentEvent, { type: "tool_result" }>;
  onJumpToRaw?: (index: number) => void;
  forceExpanded?: boolean;
}

export function LogEventRenderer({
  event,
  index,
  toolResult,
  onJumpToRaw,
  forceExpanded = false,
}: LogEventRendererProps) {
  // Handle malformed events (e.g., double-stringified)
  if (typeof event === "string") {
    return null;
  }

  const key = `${event.type}-${event.ts || Date.now()}-${index}`;

  let content: React.ReactNode;

  // Special handling for tool_call events - use ToolExecutionView
  if (event.type === "tool_call") {
    content = (
      <ToolExecutionView
        key={key}
        call={event as Extract<AgentEvent, { type: "tool_call" }>}
        result={toolResult}
        forceExpanded={forceExpanded}
        onJumpToRaw={onJumpToRaw}
        index={index}
      />
    );
  } else {
    const Component = EVENT_COMPONENT_MAP[event.type];

    if (Component) {
      content = <Component key={key} event={event} />;
      // Components handle their own timestamp wrapping, and return null if they shouldn't render
      if (content === null) {
        return null;
      }
    } else if (SKIP_EVENTS.includes(event.type)) {
      return null;
    } else {
      // Render unknown events as JSON for debugging
      content = (
        <BaseLogEntry key={key} ts={event.ts || Date.now()}>
          <Code size="2" variant="ghost">
            UNKNOWN EVENT: {JSON.stringify(event)}
          </Code>
        </BaseLogEntry>
      );
    }
  }

  // Get component name for debugging
  let componentName = "Unknown";
  if (event.type === "tool_call") {
    const toolCall = event as Extract<AgentEvent, { type: "tool_call" }>;
    componentName = `${toolCall.toolName}ToolView`;
  } else {
    const Component = EVENT_COMPONENT_MAP[event.type];
    componentName = Component?.name || event.type;
  }

  // Wrap all events in context menu for debugging
  return (
    <ContextMenu.Root key={key}>
      <ContextMenu.Trigger>
        <div style={{ cursor: "context-menu" }}>{content}</div>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        {IS_DEV && <ContextMenu.Label>{componentName}</ContextMenu.Label>}
        <ContextMenu.Item onClick={() => onJumpToRaw?.(index)}>
          Jump to raw source
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
