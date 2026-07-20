import { posthogToolMeta } from "@posthog/shared";
import type {
  ConversationSessionUpdate,
  ToolCall,
} from "@posthog/ui/features/sessions/types";
import { Theme } from "@radix-ui/themes";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ConversationItem, TurnContext } from "../buildConversationItems";
import { SubagentToolView } from "./SubagentToolView";

// The legacy thread path (no ChatThreadChrome provider) renders the bespoke
// bordered box; that's enough to assert the spinner vs. robot-icon swap.
function makeTurnContext(
  spawnId: string,
  children: ConversationItem[],
): TurnContext {
  const toolCalls = new Map<string, ToolCall>();
  for (const child of children) {
    if (child.type !== "session_update") continue;
    const update = child.update as ConversationSessionUpdate;
    if (update.sessionUpdate === "tool_call" && update.toolCallId) {
      toolCalls.set(update.toolCallId, update as unknown as ToolCall);
    }
  }
  return {
    toolCalls,
    childItems: new Map([[spawnId, children]]),
    turnCancelled: false,
    turnComplete: true,
  };
}

function childToolCall(
  id: string,
  parentId: string,
  status: ToolCall["status"],
): ConversationItem {
  return {
    type: "session_update",
    id,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: id,
      kind: "execute",
      status,
      title: id,
      _meta: posthogToolMeta({ toolName: "Bash", parentToolCallId: parentId }),
    },
    turnContext: {} as TurnContext,
  };
}

function renderView(
  toolCall: ToolCall,
  turnContext: TurnContext,
  childItems: ConversationItem[],
) {
  return render(
    <Theme>
      <SubagentToolView
        toolCall={toolCall}
        turnComplete
        childItems={childItems}
        turnContext={turnContext}
      />
    </Theme>,
  );
}

describe("SubagentToolView", () => {
  const spawnToolCall: ToolCall = {
    toolCallId: "spawn-1",
    title: "Do the thing",
    kind: "other",
    status: "completed",
    _meta: posthogToolMeta({ toolName: "Task" }),
  };

  it("shows the robot icon (no spinner) once the subagent and its children are done", () => {
    const children = [childToolCall("child-1", "spawn-1", "completed")];
    const turnContext = makeTurnContext("spawn-1", children);
    const { container } = renderView(spawnToolCall, turnContext, children);

    // DotsCircleSpinner renders braille-dot frames (class `ph-dots-frame`) only
    // while loading; otherwise LoadingIcon shows the Robot <svg>. A settled
    // subagent shows no spinner frames.
    expect(container.querySelector(".ph-dots-frame")).toBeNull();
  });

  it("keeps the spinner while a child tool call is in_progress even though the turn is complete", () => {
    const children = [childToolCall("child-1", "spawn-1", "in_progress")];
    const turnContext = makeTurnContext("spawn-1", children);
    const { container } = renderView(spawnToolCall, turnContext, children);

    // The spawn is `completed` and `turnComplete` is true, but a child is still
    // in flight — the spinner must stay up so the row doesn't read as done.
    expect(container.querySelector(".ph-dots-frame")).not.toBeNull();
  });
});
