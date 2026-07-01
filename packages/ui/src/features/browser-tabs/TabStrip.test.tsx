import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TabStrip, type TabView } from "./TabStrip";

const tabs: TabView[] = [
  { id: "t1", label: "Overview", channelName: "growth" },
  { id: "t2", label: "Funnels", channelName: null },
];

function setup(overrides?: Partial<Parameters<typeof TabStrip>[0]>) {
  const props = {
    tabs,
    activeTabId: "t1",
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onNewTab: vi.fn(),
    ...overrides,
  };
  render(<TabStrip {...props} />);
  return props;
}

describe("TabStrip", () => {
  it("renders a pill per tab with its label", () => {
    setup();
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Funnels")).toBeTruthy();
  });

  it("marks the active tab as selected", () => {
    setup({ activeTabId: "t2" });
    const selected = screen
      .getAllByRole("tab")
      .filter((el) => el.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("Funnels");
  });

  it("calls onSelect with the tab id when a pill is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByText("Funnels"));
    expect(props.onSelect).toHaveBeenCalledWith("t2");
  });

  it("closes without selecting when the close affordance is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText("Close Funnels"));
    expect(props.onClose).toHaveBeenCalledWith("t2");
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("calls onNewTab when the new-tab button is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText("New tab"));
    expect(props.onNewTab).toHaveBeenCalledTimes(1);
  });
});
