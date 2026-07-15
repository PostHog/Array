import { posthogToolMeta } from "@posthog/shared";
import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolGroup } from "./ToolGroup";

function subagentItem(
  id: string,
): Extract<ConversationItem, { type: "session_update" }> {
  return {
    type: "session_update",
    id,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: id,
      title: "Subagent",
      kind: "other",
      status: "completed",
      _meta: posthogToolMeta({ toolName: "spawn_agent" }),
    },
    turnContext: {
      toolCalls: new Map(),
      childItems: new Map(),
      turnCancelled: false,
      turnComplete: true,
    },
  } as Extract<ConversationItem, { type: "session_update" }>;
}

describe("ToolGroup", () => {
  it("labels Codex spawn batches as subagents", () => {
    render(
      <Theme>
        <ToolGroup tools={[subagentItem("spawn-1"), subagentItem("spawn-2")]} />
      </Theme>,
    );

    expect(screen.getByText("Used Subagents")).toBeInTheDocument();
  });
});
