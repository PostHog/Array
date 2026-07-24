import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { openUrlInBrowser } = vi.hoisted(() => ({
  openUrlInBrowser: vi.fn(),
}));

vi.mock("@posthog/ui/utils/browser", () => ({ openUrlInBrowser }));

import { ChannelPrButton } from "./ChannelPrButton";

describe("ChannelPrButton", () => {
  it.each([
    ["open", "Ready #123"],
    ["merged", "Merged #123"],
  ] as const)("renders the %s lifecycle caption", (prState, label) => {
    render(
      <ChannelPrButton
        prUrl="https://github.com/PostHog/code/pull/123"
        prState={prState}
      />,
    );

    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("opens the PR without activating the parent card", async () => {
    const user = userEvent.setup();
    render(
      <ChannelPrButton
        prUrl="https://github.com/PostHog/code/pull/123"
        prState="open"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Ready #123" }));

    expect(openUrlInBrowser).toHaveBeenCalledWith(
      "https://github.com/PostHog/code/pull/123",
    );
  });
});
