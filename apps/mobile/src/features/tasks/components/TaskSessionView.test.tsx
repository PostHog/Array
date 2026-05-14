import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { TaskSessionView } from "./TaskSessionView";

vi.mock("phosphor-react-native", () => ({
  ArrowDown: (props: Record<string, unknown>) =>
    createElement("ArrowDown", props),
  Brain: (props: Record<string, unknown>) => createElement("Brain", props),
  CaretRight: (props: Record<string, unknown>) =>
    createElement("CaretRight", props),
  CloudArrowDown: (props: Record<string, unknown>) =>
    createElement("CloudArrowDown", props),
  Robot: (props: Record<string, unknown>) => createElement("Robot", props),
}));

vi.mock("@/features/chat", () => ({
  AgentMessage: (props: Record<string, unknown>) =>
    createElement("AgentMessage", props),
  HumanMessage: (props: Record<string, unknown>) =>
    createElement("HumanMessage", props),
  ToolMessage: (props: Record<string, unknown>) =>
    createElement("ToolMessage", props),
  deriveToolKind: () => "other",
}));

vi.mock("@/features/chat/utils/thinkingMessages", () => ({
  getRandomThinkingActivity: () => "Thinking",
}));

vi.mock("@/lib/theme", () => ({
  useThemeColors: () => ({
    gray: { 8: "#888", 9: "#777", 11: "#555" },
    accent: { 9: "#f60" },
    status: { error: "#d00" },
  }),
}));

vi.mock("./PlanStatusBar", () => ({
  PlanStatusBar: (props: Record<string, unknown>) =>
    createElement("PlanStatusBar", props),
}));

vi.mock("./QuestionCard", () => ({
  QuestionCard: (props: Record<string, unknown>) =>
    createElement("QuestionCard", props),
}));

vi.mock("./PlanApprovalCard", () => ({
  PlanApprovalCard: (props: Record<string, unknown>) =>
    createElement("PlanApprovalCard", props),
}));

describe("TaskSessionView", () => {
  it("keeps question tools pending after the run goes idle", () => {
    const events = [
      {
        type: "session_update" as const,
        ts: 1,
        notification: {
          update: {
            sessionUpdate: "tool_call",
            title: "Which license should I use?",
            toolCallId: "question-1",
            status: "pending" as const,
            rawInput: {
              questions: [
                {
                  question: "Which license should I use?",
                  options: [{ label: "MIT" }],
                },
              ],
            },
            _meta: {
              claudeCode: {
                toolName: "AskUserQuestion",
              },
            },
          },
        },
      },
    ];

    let renderer: ReturnType<typeof create> | null = null;

    act(() => {
      renderer = create(
        createElement(TaskSessionView, {
          events,
          isConnecting: false,
          isThinking: true,
        }),
      );
    });

    if (!renderer) {
      throw new Error("Renderer not created");
    }

    act(() => {
      renderer.update(
        createElement(TaskSessionView, {
          events,
          isConnecting: false,
          isThinking: false,
        }),
      );
    });

    expect(renderer.root.findByType("QuestionCard").props.toolData.status).toBe(
      "pending",
    );
  });
});
