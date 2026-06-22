import type { ToolCall } from "@posthog/ui/features/sessions/types";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { McpToolView } from "./McpToolView";

const ERROR_MARKER = "Sentinel error reason for testing";
const OUTPUT_MARKER = "Sentinel success output for testing";

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolCallId: "tc-1",
    title: "posthog",
    kind: "other",
    status: "completed",
    rawInput: { foo: "bar" },
    ...overrides,
  };
}

function textContent(text: string): NonNullable<ToolCall["content"]> {
  return [{ type: "content", content: { type: "text", text } }];
}

function renderView(toolCall: ToolCall) {
  return render(
    <Theme>
      <McpToolView toolCall={toolCall} mcpToolName="posthog__query" expanded />
    </Theme>,
  );
}

describe("McpToolView", () => {
  it("renders the error reason when the tool call failed", () => {
    renderView(
      makeToolCall({ status: "failed", content: textContent(ERROR_MARKER) }),
    );

    expect(screen.getByText(ERROR_MARKER)).toBeInTheDocument();
  });

  it("still renders output when the tool call completed", () => {
    renderView(
      makeToolCall({
        status: "completed",
        content: textContent(OUTPUT_MARKER),
      }),
    );

    expect(screen.getByText(OUTPUT_MARKER)).toBeInTheDocument();
  });
});
