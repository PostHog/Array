import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentStatusLine, UserPromptRow } from "./ThreadPanel";

describe("AgentStatusLine", () => {
  it("renders working status outside the conversation timeline", () => {
    render(<AgentStatusLine status={{ phase: "active", label: "Working…" }} />);

    const status = screen.getByText("Working…");

    expect(status.closest("article")).toBeNull();
    expect(status.closest('[data-slot="thread-item-body"]')).toBeNull();
    expect(status.closest("output")).not.toBeNull();
  });
});

describe("UserPromptRow", () => {
  it("prefixes direct task prompts with @agent", () => {
    render(
      <UserPromptRow
        message={{ id: "prompt", text: "Investigate this", timestamp: 1 }}
        author={{ id: 1, uuid: "user", email: "user@example.com" }}
      />,
    );

    expect(screen.getByText("@agent")).toBeInTheDocument();
    expect(screen.getByText("Investigate this")).toBeInTheDocument();
  });

  it("hides forwarded thread attribution and duplicate agent mentions", () => {
    render(
      <UserPromptRow
        message={{
          id: "prompt",
          text: "[Thread comment from Peter Kirkham] @agent which model are you?",
          timestamp: 1,
        }}
        author={{ id: 1, uuid: "user", email: "user@example.com" }}
      />,
    );

    expect(screen.getAllByText("@agent")).toHaveLength(1);
    expect(screen.getByText("which model are you?")).toBeInTheDocument();
    expect(screen.queryByText(/Thread comment from/)).not.toBeInTheDocument();
  });
});
