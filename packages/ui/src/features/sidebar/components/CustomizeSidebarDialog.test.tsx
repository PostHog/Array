import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock("@posthog/ui/shell/analytics", () => ({ track }));

import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { CustomizeSidebarDialog } from "./CustomizeSidebarDialog";

function renderDialog() {
  return render(
    <Theme>
      <CustomizeSidebarDialog open onOpenChange={vi.fn()} />
    </Theme>,
  );
}

describe("CustomizeSidebarDialog", () => {
  beforeEach(() => {
    track.mockReset();
    useSidebarStore.setState({ navItemOverrides: {} });
  });

  it("unchecking a visible item demotes it and tracks the change", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("checkbox", { name: "MCP servers" }));

    expect(useSidebarStore.getState().navItemOverrides["mcp-servers"]).toBe(
      false,
    );
    expect(track).toHaveBeenCalledWith(ANALYTICS_EVENTS.SIDEBAR_CUSTOMIZED, {
      item: "mcp_servers",
      visible: false,
    });
  });

  it("checking a hidden item promotes it and tracks the change", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("checkbox", { name: "Search" }));

    expect(useSidebarStore.getState().navItemOverrides.search).toBe(true);
    expect(track).toHaveBeenCalledWith(ANALYTICS_EVENTS.SIDEBAR_CUSTOMIZED, {
      item: "search",
      visible: true,
    });
  });
});
