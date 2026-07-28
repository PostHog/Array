import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@posthog/ui/features/canvas/hooks/useTaskActivity", () => ({
  useTaskActivity: () => ({ unreadCount: 1 }),
}));
vi.mock(
  "@posthog/ui/features/command-center/useCommandCenterActiveCount",
  () => ({ useCommandCenterActiveCount: () => 0 }),
);
vi.mock("@posthog/ui/features/inbox/hooks/useInboxAllReports", () => ({
  useInboxAllReports: () => ({ counts: { pulls: 0 } }),
}));
vi.mock("@posthog/ui/router/useAppView", () => ({
  useAppView: () => ({ type: "task-input" }),
}));
vi.mock("@posthog/ui/router/navigationBridge", () => ({
  navigateToActivity: vi.fn(),
  navigateToInbox: vi.fn(),
  navigateToWebsiteCommandCenter: vi.fn(),
}));
vi.mock("@posthog/ui/shell/analytics", () => ({ track: vi.fn() }));
vi.mock("./ActivityHoverCard", () => ({
  ActivityHoverCard: () => <div>Unread activity card</div>,
}));

import { ChannelNav } from "./ChannelNav";

describe("ChannelNav", () => {
  it("opens unread activity from the bell after the hover delay", async () => {
    const user = userEvent.setup();
    render(<ChannelNav />);

    await user.hover(screen.getByLabelText("Activity"));
    expect(screen.queryByText("Unread activity card")).not.toBeInTheDocument();

    expect(
      await screen.findByText("Unread activity card", {}, { timeout: 1_000 }),
    ).toBeInTheDocument();
  });
});
