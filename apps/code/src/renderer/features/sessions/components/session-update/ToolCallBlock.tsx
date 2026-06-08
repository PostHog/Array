import type {
  ConversationItem,
  TurnContext,
} from "@features/sessions/components/buildConversationItems";
import type { ToolCall } from "@features/sessions/types";
import { Box } from "@radix-ui/themes";
import { DeleteToolView } from "./DeleteToolView";
import { EditToolView } from "./EditToolView";
import { ExecuteToolView } from "./ExecuteToolView";
import { FetchToolView } from "./FetchToolView";
import { McpToolBlock } from "./McpToolBlock";
import { MoveToolView } from "./MoveToolView";
import { PlanApprovalView } from "./PlanApprovalView";
import { QuestionToolView } from "./QuestionToolView";
import { ReadToolView } from "./ReadToolView";
import { SearchToolView } from "./SearchToolView";
import { SubagentToolView } from "./SubagentToolView";
import { ThinkToolView } from "./ThinkToolView";
import { ToolCallView } from "./ToolCallView";
import type { ToolViewProps } from "./toolCallUtils";

interface ToolCallBlockProps extends ToolViewProps {
  childItems?: ConversationItem[];
  childItemsMap?: Map<string, ConversationItem[]>;
}

export function ToolCallBlock({
  toolCall,
  turnCancelled,
  turnComplete,
  childItems,
  childItemsMap,
}: ToolCallBlockProps) {
  const meta = toolCall._meta as
    | { claudeCode?: { toolName?: string } }
    | undefined;
  const toolName = meta?.claudeCode?.toolName;

  if (toolName === "EnterPlanMode") {
    return null;
  }

  const props = { toolCall, turnCancelled, turnComplete };

  if (
    (toolName === "Task" || toolName === "Agent") &&
    childItems &&
    childItems.length > 0
  ) {
    const turnContext: TurnContext = {
      toolCalls: buildChildToolCallsMap(childItems),
      childItems: childItemsMap ?? new Map(),
      turnCancelled: turnCancelled ?? false,
      turnComplete: turnComplete ?? false,
      lastCheckpointId: null,
    };
    return (
      <Box className="pl-3">
        <SubagentToolView
          {...props}
          childItems={childItems}
          turnContext={turnContext}
        />
      </Box>
    );
  }

  if (toolName?.startsWith("mcp__")) {
    return (
      <Box className="pl-3">
        <McpToolBlock {...props} mcpToolName={toolName} />
      </Box>
    );
  }

  const content = (() => {
    switch (toolCall.kind) {
      case "switch_mode":
        return <PlanApprovalView {...props} />;
      case "execute":
        return <ExecuteToolView {...props} />;
      case "read":
        return <ReadToolView {...props} />;
      case "edit":
        return <EditToolView {...props} />;
      case "delete":
        return <DeleteToolView {...props} />;
      case "move":
        return <MoveToolView {...props} />;
      case "search":
        return <SearchToolView {...props} />;
      case "think":
        return <ThinkToolView {...props} />;
      case "fetch":
        return <FetchToolView {...props} />;
      case "question":
        return <QuestionToolView {...props} />;
      default:
        return <ToolCallView {...props} agentToolName={toolName} />;
    }
  })();

  return <Box className="pl-3">{content}</Box>;
}

function buildChildToolCallsMap(
  childItems: ConversationItem[],
): Map<string, ToolCall> {
  const map = new Map<string, ToolCall>();
  for (const item of childItems) {
    if (
      item.type === "session_update" &&
      item.update.sessionUpdate === "tool_call"
    ) {
      const tc = item.update as unknown as ToolCall;
      if (tc.toolCallId) {
        map.set(tc.toolCallId, tc);
      }
    }
  }
  return map;
}
