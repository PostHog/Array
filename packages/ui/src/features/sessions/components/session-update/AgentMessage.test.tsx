import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentMessage } from "./AgentMessage";

describe("AgentMessage", () => {
  it("keeps the copy action inside the message rail", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <Theme>
        <AgentMessage content="Assistant response" />
      </Theme>,
    );

    const copyButton = screen.getByLabelText("Copy message");
    expect(copyButton.parentElement).toHaveClass("right-1");
    expect(copyButton.parentElement).not.toHaveClass("left-full");

    await userEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledWith("Assistant response");
  });
});
