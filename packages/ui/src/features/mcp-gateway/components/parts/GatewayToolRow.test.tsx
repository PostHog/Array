import type { McpResolvedToolPolicy } from "@posthog/api-client/posthog-client";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GatewayToolRow } from "./GatewayToolRow";

const policy: McpResolvedToolPolicy = {
  tool_name: "search_items",
  description:
    "Search the catalog for matching items.\n\n- Match by title\n- Match by description",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
  },
  policy_state: "needs_approval",
  team_state: null,
  locked: false,
  decided_by: "default",
  rule_name: "",
  rule_description: "",
};

describe("GatewayToolRow", () => {
  it("shows separate description and input schema sections when expanded", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Theme>
        <GatewayToolRow policy={policy} editable onChange={vi.fn()} />
      </Theme>,
    );

    await user.click(screen.getByRole("button", { name: /search_items/i }));

    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Input schema")).toBeInTheDocument();
    expect(container.querySelector(".whitespace-pre-wrap")).toHaveTextContent(
      "Search the catalog for matching items. - Match by title - Match by description",
    );
    expect(container.querySelector("pre")?.textContent).toBe(
      JSON.stringify(policy.input_schema, null, 2),
    );
  });
});
