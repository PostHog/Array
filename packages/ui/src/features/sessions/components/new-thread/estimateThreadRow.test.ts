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

function editToolCall(diff: {
  path: string;
  oldText?: string | null;
  newText: string;
}): ConversationItem {
  return {
    type: "session_update",
    id: "t",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "t",
      title: "Edit",
      content: [{ type: "diff", ...diff }],
    },
    turnContext: {} as never,
  } as ConversationItem;
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

  it.each([
    ["git_action", { type: "git_action", id: "c", actionType: "push" }, 36],
    [
      "skill_button_action",
      { type: "skill_button_action", id: "c", buttonId: "add-analytics" },
      44,
    ],
    [
      "git_action_result",
      { type: "git_action_result", id: "c", actionType: "push", turnId: "t" },
      64,
    ],
    ["turn_cancelled", { type: "turn_cancelled", id: "c" }, 40],
    [
      "user_shell_execute",
      { type: "user_shell_execute", id: "c", command: "ls", cwd: "/" },
      64,
    ],
  ] as const satisfies readonly [string, ConversationItem, number][])(
    "sizes the %s chip row at a fixed small height",
    (_label, item, expected) => {
      expect(estimateThreadRow(itemRow(item))).toBe(expected);
    },
  );

  it("estimates a new file by its full length, not a flat chip", () => {
    const big = estimateThreadRow(
      itemRow(editToolCall({ path: "src/a.ts", newText: "x\n".repeat(40) })),
    );
    expect(big).toBeGreaterThan(300);
  });

  it("caps a huge diff at the CodePreview max height", () => {
    const huge = estimateThreadRow(
      itemRow(editToolCall({ path: "src/a.ts", newText: "x\n".repeat(5000) })),
    );
    expect(huge).toBeLessThan(800);
  });

  it("sizes a small edit in a large file by its hunk, not the whole file", () => {
    const file = Array(500).fill("line").join("\n");
    const edited = file.replace("line\nline\nline", "line\nCHANGED\nline");
    const smallEdit = estimateThreadRow(
      itemRow(
        editToolCall({ path: "src/a.ts", oldText: file, newText: edited }),
      ),
    );
    const fullFile = estimateThreadRow(
      itemRow(editToolCall({ path: "src/a.ts", newText: file })),
    );
    expect(smallEdit).toBeLessThan(400);
    expect(smallEdit).toBeLessThan(fullFile);
  });

  it("estimates a plan-file edit as collapsed (header only)", () => {
    const plan = estimateThreadRow(
      itemRow(
        editToolCall({
          path: "/home/user/.claude/plans/p.md",
          newText: "x\n".repeat(200),
        }),
      ),
    );
    expect(plan).toBeLessThan(80);
  });
});
