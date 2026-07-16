import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentTurnRow } from "./ThreadPanel";

describe("AgentTurnRow", () => {
  it.each([
    { phase: "active" as const, label: "Working…" },
    { phase: "complete" as const, label: "Done" },
  ])("renders $label in the message area", (statusValue) => {
    render(<AgentTurnRow status={statusValue} streaming={false} />);

    const author = screen.getByText("Agent");
    const status = screen.getByText(statusValue.label);

    expect(author.parentElement).not.toContainElement(status);
    expect(author.closest("article")).toContainElement(status);
    expect(status.closest('[data-slot="thread-item-body"]')).not.toBeNull();
  });
});
