import type { Step } from "@components/ui/StepList";
import type { ConversationItem } from "@features/sessions/components/buildConversationItems";
import type { SessionUpdate, ToolCall } from "@features/sessions/types";
import { memo } from "react";

import { AgentMessage } from "./AgentMessage";
import { CompactBoundaryView } from "./CompactBoundaryView";
import { ConsoleMessage } from "./ConsoleMessage";
import { ErrorNotificationView } from "./ErrorNotificationView";
import { ProgressGroupView } from "./ProgressGroupView";
import { StatusNotificationView } from "./StatusNotificationView";
import { TaskNotificationView } from "./TaskNotificationView";
import { ThoughtView } from "./ThoughtView";
import { ToolCallBlock } from "./ToolCallBlock";

export type RenderItem =
  | SessionUpdate
  | {
      sessionUpdate: "console";
      level: string;
      message: string;
      timestamp?: string;
    }
  | {
      sessionUpdate: "compact_boundary";
      trigger: "manual" | "auto";
      preTokens: number;
      contextSize?: number;
    }
  | {
      sessionUpdate: "status";
      status: string;
      isComplete?: boolean;
    }
  | {
      sessionUpdate: "error";
      errorType: string;
      message: string;
    }
  | {
      sessionUpdate: "task_notification";
      taskId: string;
      status: "completed" | "failed" | "stopped";
      summary: string;
      outputFile: string;
    }
  | {
      sessionUpdate: "progress_group";
      steps: Step[];
      isActive: boolean;
    };

interface SessionUpdateViewProps {
  item: RenderItem;
  toolCalls?: Map<string, ToolCall>;
  childItems?: Map<string, ConversationItem[]>;
  turnCancelled?: boolean;
  turnComplete?: boolean;
  thoughtComplete?: boolean;
}

export const SessionUpdateView = memo(function SessionUpdateView({
  item,
  toolCalls,
  childItems,
  turnCancelled,
  turnComplete,
  thoughtComplete,
}: SessionUpdateViewProps) {
  switch (item.sessionUpdate) {
    case "user_message_chunk":
      return null;
    case "agent_message_chunk":
      return item.content.type === "text" ? (
        <AgentMessage content={item.content.text} />
      ) : null;
    case "agent_thought_chunk":
      return item.content.type === "text" ? (
        <ThoughtView content={item.content.text} isLoading={!thoughtComplete} />
      ) : null;
    case "tool_call":
      return (
        <ToolCallBlock
          toolCall={toolCalls?.get(item.toolCallId) ?? item}
          turnCancelled={turnCancelled}
          turnComplete={turnComplete}
          childItems={childItems?.get(item.toolCallId)}
          childItemsMap={childItems}
        />
      );
    case "tool_call_update":
      return null;
    case "plan":
      return null;
    case "available_commands_update":
      return null;
    case "config_option_update":
      return null;
    case "console":
      return (
        <ConsoleMessage
          level={item.level as "info" | "debug" | "warn" | "error"}
          message={item.message}
          timestamp={item.timestamp}
        />
      );
    case "compact_boundary":
      return (
        <CompactBoundaryView
          trigger={item.trigger}
          preTokens={item.preTokens}
          contextSize={item.contextSize}
        />
      );
    case "status":
      return (
        <StatusNotificationView
          status={item.status}
          isComplete={item.isComplete}
        />
      );
    case "error":
      return (
        <ErrorNotificationView
          errorType={item.errorType}
          message={item.message}
        />
      );
    case "task_notification":
      return (
        <TaskNotificationView status={item.status} summary={item.summary} />
      );
    case "progress_group":
      return (
        <ProgressGroupView
          steps={item.steps}
          isActive={item.isActive}
          turnComplete={turnComplete}
        />
      );
    default:
      return null;
  }
});
