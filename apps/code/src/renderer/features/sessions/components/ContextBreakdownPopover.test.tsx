import type { ContextUsage } from "@features/sessions/hooks/useContextUsage";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextBreakdownPopover } from "./ContextBreakdownPopover";

function usageWith(
  breakdown: ContextUsage["breakdown"],
  overrides?: Partial<ContextUsage>,
): ContextUsage {
  return {
    used: 74_000,
    size: 200_000,
    percentage: 37,
    cost: null,
    breakdown,
    ...overrides,
  };
}

describe("ContextBreakdownPopover", () => {
  it("renders the header with aggregate tokens", () => {
    render(
      <Theme>
        <ContextBreakdownPopover usage={usageWith(null)} />
      </Theme>,
    );
    expect(screen.getByText(/74K \/ 200K tokens/)).toBeInTheDocument();
    expect(screen.getByText("37% full")).toBeInTheDocument();
  });

  it("shows the placeholder copy when breakdown is missing", () => {
    render(
      <Theme>
        <ContextBreakdownPopover usage={usageWith(null)} />
      </Theme>,
    );
    expect(
      screen.getByText(/Detailed breakdown available after the first response/),
    ).toBeInTheDocument();
  });

  it("renders one row per non-zero category", () => {
    render(
      <Theme>
        <ContextBreakdownPopover
          usage={usageWith({
            systemPrompt: 4000,
            tools: 0,
            rules: 0,
            skills: 0,
            mcp: 1500,
            subagents: 0,
            conversation: 68_500,
          })}
        />
      </Theme>,
    );
    expect(screen.getByText("System prompt")).toBeInTheDocument();
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.getByText("Conversation")).toBeInTheDocument();
    expect(screen.queryByText("Tools")).not.toBeInTheDocument();
    expect(screen.queryByText("Rules")).not.toBeInTheDocument();
  });
});
