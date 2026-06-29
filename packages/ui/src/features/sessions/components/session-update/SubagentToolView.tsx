import { Robot } from "@phosphor-icons/react";
import {
  type ToolViewProps,
  useToolCallStatus,
} from "@posthog/ui/features/sessions/components/session-update/toolCallUtils";
import type { ConversationItem, TurnContext } from "../buildConversationItems";
import { SessionUpdateView } from "./SessionUpdateView";
import { ToolRow } from "./ToolRow";

interface SubagentToolViewProps extends ToolViewProps {
  childItems: ConversationItem[];
  turnContext: TurnContext;
}

/**
 * A subagent (Task/Agent) call: same minimal shape as {@link ThoughtView} — a single `ToolRow`
 * whose collapsible body holds the subagent's own child tool calls (rendered through
 * `SessionUpdateView`). `ToolRow` supplies the chrome for both threads (ChatMarker / Radix
 * collapsible), so there's no bespoke box or expand button here.
 */
export function SubagentToolView({
  toolCall,
  turnCancelled,
  turnComplete,
  childItems,
  turnContext,
}: SubagentToolViewProps) {
  const { title } = toolCall;
  const { isLoading, isFailed, wasCancelled } = useToolCallStatus(
    toolCall.status,
    turnCancelled,
    turnComplete,
  );

  const childContent =
    childItems.length > 0
      ? childItems.map((child) =>
          child.type === "session_update" ? (
            <SessionUpdateView
              key={child.id}
              item={child.update}
              toolCalls={turnContext.toolCalls}
              childItems={turnContext.childItems}
              turnCancelled={turnContext.turnCancelled}
              turnComplete={turnContext.turnComplete}
            />
          ) : null,
        )
      : undefined;

  return (
    <div>
      <ToolRow
        icon={Robot}
        isLoading={isLoading}
        isFailed={isFailed}
        wasCancelled={wasCancelled}
        content={childContent}
      >
        {title || "Subagent"}
      </ToolRow>
    </div>
  );
}
