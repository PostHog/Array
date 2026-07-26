import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock("@posthog/ui/shell/analytics", () => ({ track }));
vi.mock("@posthog/ui/features/feature-flags/useFeatureFlag", () => ({
  useFeatureFlag: () => true,
}));
vi.mock("@posthog/host-router/react", () => ({
  useHostTRPCClient: () => ({ os: { selectDirectory: { query: vi.fn() } } }),
}));
vi.mock("@posthog/ui/features/auth/useMeQuery", () => ({
  useMeQuery: () => ({ data: { is_staff: false } }),
}));
vi.mock("@posthog/ui/features/folders/useFolders", () => ({
  useFolders: () => ({ addFolder: vi.fn() }),
}));
vi.mock("@posthog/ui/features/sidebar/useHoldSidebarPeek", () => ({
  useHoldSidebarPeek: () => vi.fn(),
}));
vi.mock("@posthog/ui/shell/commandMenuStore", () => ({
  useCommandMenuStore: (selector: (state: { open: () => void }) => unknown) =>
    selector({ open: vi.fn() }),
}));

import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { TasksHeader } from "./TasksHeader";

describe("TasksHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSidebarStore.setState({ channelsEnabled: false });
  });

  it("switches modes from the panel title and changes the available actions", async () => {
    const user = userEvent.setup();
    render(
      <Theme>
        <TasksHeader />
      </Theme>,
    );

    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Filter tasks" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show channels" }));

    expect(screen.getByText("Channels")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Filter tasks" }),
    ).not.toBeInTheDocument();
    expect(track).toHaveBeenCalledWith(ANALYTICS_EVENTS.CHANNEL_ACTION, {
      action_type: "toggle_channels",
      surface: "nav",
    });
  });
});
