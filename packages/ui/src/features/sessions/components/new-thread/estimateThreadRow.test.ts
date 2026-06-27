import type { ConversationItem } from "@posthog/ui/features/sessions/components/buildConversationItems";
import type { ThreadRow } from "@posthog/ui/features/sessions/components/new-thread/buildThreadGroups";
import { estimateThreadRow } from "@posthog/ui/features/sessions/components/new-thread/estimateThreadRow";
import { describe, expect, it } from "vitest";

function userMessage(content: string): ConversationItem {
  return { type: "user_message", id: "u", content, timestamp: 0 };
}

function itemRow(item: ConversationItem): ThreadRow {
  return { kind: "item", id: item.id, item };
}

describe("estimateThreadRow", () => {
  it("estimates a collapsed tool group as just its chip", () => {
    const row: ThreadRow = {
      kind: "tool_group",
      id: "g",
      items: [userMessage("a".repeat(2000))],
      summary: {} as never,
      turnComplete: true,
      expanded: false,
    };
    expect(estimateThreadRow(row)).toBe(44);
  });

  it("estimates an expanded group as the stack of its items", () => {
    const items = [userMessage("short"), userMessage("short")];
    const collapsed: ThreadRow = {
      kind: "tool_group",
      id: "g",
      items,
      summary: {} as never,
      turnComplete: true,
      expanded: false,
    };
    const expanded: ThreadRow = { ...collapsed, expanded: true };
    expect(estimateThreadRow(expanded)).toBeGreaterThan(
      estimateThreadRow(collapsed),
    );
  });

  it("scales a message estimate with its line count", () => {
    const oneLine = estimateThreadRow(itemRow(userMessage("hi")));
    const manyLines = estimateThreadRow(
      itemRow(userMessage(Array(10).fill("line").join("\n"))),
    );
    expect(manyLines).toBeGreaterThan(oneLine);
  });

  it("keeps chip-style rows well under the old flat 80px guess", () => {
    expect(
      estimateThreadRow(
        itemRow({ type: "git_action", id: "g", actionType: "push" }),
      ),
    ).toBeLessThan(80);
  });
});
