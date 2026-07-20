import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MentionText } from "./MentionText";

describe("MentionText", () => {
  it("uses the shared mention styles and emphasizes the current user", () => {
    render(
      <MentionText
        content="@[Alice](alice@example.com) and @[Bob](bob@example.com)"
        currentUserEmail="bob@example.com"
      />,
    );

    expect(screen.getByText("@Alice")).toHaveClass("mention-chip");
    expect(screen.getByText("@Alice")).not.toHaveClass("mention-chip--self");
    expect(screen.getByText("@Bob")).toHaveClass(
      "mention-chip",
      "mention-chip--self",
    );
  });

  it("highlights a literal agent mention", () => {
    render(<MentionText content="@agent investigate this" />);

    expect(screen.getByText("@agent")).toHaveClass("mention-chip");
  });

  it("does not highlight agent text inside another token", () => {
    render(<MentionText content="person@agent.com" />);

    expect(screen.queryByText("@agent")).not.toBeInTheDocument();
  });

  it("keeps agent text inside a markdown link label", () => {
    render(
      <MentionText content="[My @agent report](https://posthog.com/report) has been created" />,
    );

    expect(
      screen.getByRole("link", { name: "My @agent report" }),
    ).toHaveAttribute("href", "https://posthog.com/report");
    expect(screen.queryByText("@agent")).not.toBeInTheDocument();
  });

  it("inherits the surrounding message text size", () => {
    render(<MentionText content="A thread reply" />);

    expect(screen.getByText("A thread reply")).not.toHaveClass("text-xs");
  });
});
