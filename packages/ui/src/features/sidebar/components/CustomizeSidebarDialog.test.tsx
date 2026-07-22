import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { Theme } from "@radix-ui/themes";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type CapturedDragEvent = {
  operation: { source?: { id?: string }; target?: { id?: string } };
  canceled?: boolean;
};

const { track, dndCapture } = vi.hoisted(() => ({
  track: vi.fn(),
  dndCapture: {} as {
    onDragStart?: (event: CapturedDragEvent) => void;
    onDragOver?: (event: CapturedDragEvent) => void;
    onDragEnd?: (event: CapturedDragEvent) => void;
  },
}));

vi.mock("@posthog/ui/shell/analytics", () => ({ track }));
vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({
    onDragStart,
    onDragOver,
    onDragEnd,
    children,
  }: {
    onDragStart?: (event: CapturedDragEvent) => void;
    onDragOver?: (event: CapturedDragEvent) => void;
    onDragEnd?: (event: CapturedDragEvent) => void;
    children?: React.ReactNode;
  }) => {
    dndCapture.onDragStart = onDragStart;
    dndCapture.onDragOver = onDragOver;
    dndCapture.onDragEnd = onDragEnd;
    return <>{children}</>;
  },
}));
vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({
    ref: () => {},
    handleRef: () => {},
    isDragging: false,
  }),
}));
vi.mock("@dnd-kit/dom", () => ({ PointerSensor: class {} }));

import {
  CUSTOMIZABLE_NAV_ITEM_IDS,
  type CustomizableNavItemId,
} from "@posthog/ui/features/sidebar/constants";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { CustomizeSidebarDialog } from "./CustomizeSidebarDialog";

function availability(
  overrides: Partial<Record<CustomizableNavItemId, boolean>> = {},
) {
  return {
    ...(Object.fromEntries(
      CUSTOMIZABLE_NAV_ITEM_IDS.map((id) => [id, true]),
    ) as Record<CustomizableNavItemId, boolean>),
    ...overrides,
  };
}

function renderDialog(available = availability()) {
  return render(
    <Theme>
      <CustomizeSidebarDialog
        open
        onOpenChange={vi.fn()}
        available={available}
      />
    </Theme>,
  );
}

function drag(
  sourceId: string,
  targetId: string,
  { cancel = false }: { cancel?: boolean } = {},
) {
  act(() => {
    dndCapture.onDragStart?.({ operation: { source: { id: sourceId } } });
    dndCapture.onDragOver?.({
      operation: { source: { id: sourceId }, target: { id: targetId } },
    });
    dndCapture.onDragEnd?.({
      operation: { source: { id: sourceId }, target: { id: targetId } },
      canceled: cancel,
    });
  });
}

describe("CustomizeSidebarDialog", () => {
  beforeEach(() => {
    track.mockReset();
    useSidebarStore.setState({ navItemOverrides: {}, navItemOrder: [] });
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

  it("omits items marked unavailable", () => {
    renderDialog(availability({ loops: false }));

    expect(
      screen.queryByRole("checkbox", { name: "Loops" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Configure" }),
    ).toBeInTheDocument();
  });

  it("renders rows in the stored order", () => {
    useSidebarStore.setState({ navItemOrder: ["loops", "search"] });
    renderDialog();

    const labels = screen
      .getAllByRole("checkbox")
      .map((checkbox) => checkbox.closest("label")?.textContent);

    expect(labels.slice(0, 2)).toEqual(["Loops", "Search"]);
  });

  it("dragging a row persists the new order and tracks on drop", () => {
    renderDialog();

    drag("skills", "search");

    expect(useSidebarStore.getState().navItemOrder).toEqual([
      "skills",
      "search",
      "inbox",
      "agents",
      "mcp-servers",
      "command-center",
      "contexts",
      "activity",
      "configure",
      "loops",
    ]);
    expect(track).toHaveBeenCalledWith(ANALYTICS_EVENTS.SIDEBAR_REORDERED, {
      item: "skills",
      to_index: 0,
    });
  });

  it("a canceled drag restores the order from dragstart", () => {
    renderDialog();

    drag("skills", "search", { cancel: true });

    expect(useSidebarStore.getState().navItemOrder).toEqual([]);
    expect(track).not.toHaveBeenCalled();
  });
});
