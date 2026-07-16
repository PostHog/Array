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
});
