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

function dragStart(sourceId: string) {
  act(() => {
    dndCapture.onDragStart?.({ operation: { source: { id: sourceId } } });
  });
}

function dragOver(sourceId: string, targetId: string) {
  act(() => {
    dndCapture.onDragOver?.({
      operation: { source: { id: sourceId }, target: { id: targetId } },
    });
  });
}

function dragEnd(
  sourceId: string,
  { cancel = false }: { cancel?: boolean } = {},
) {
  act(() => {
    dndCapture.onDragEnd?.({
      operation: { source: { id: sourceId } },
      canceled: cancel,
    });
  });
}

function rowLabels() {
  return screen
    .getAllByRole("checkbox")
    .map((checkbox) => checkbox.closest("label")?.textContent);
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
    useSidebarStore.setState({ navItemOrder: ["configure", "search"] });
    renderDialog();

    expect(rowLabels().slice(0, 2)).toEqual(["Configure", "Search"]);
  });

  it("previews on dragover and persists only on drop", () => {
    renderDialog();

    dragStart("skills");
    dragOver("skills", "search");

    expect(rowLabels()[0]).toBe("Skills");
    expect(useSidebarStore.getState().navItemOrder).toEqual([]);
    expect(track).not.toHaveBeenCalled();

    dragEnd("skills");

    expect(useSidebarStore.getState().navItemOrder).toEqual([
      "skills",
      "search",
      "inbox",
      "agents",
      "loops",
      "mcp-servers",
      "command-center",
      "contexts",
      "activity",
      "configure",
    ]);
    expect(track).toHaveBeenCalledWith(ANALYTICS_EVENTS.SIDEBAR_REORDERED, {
      item: "skills",
      to_index: 0,
    });
  });

  it("ignores a repeated dragover for the same source and target", () => {
    renderDialog();

    dragStart("skills");
    dragOver("skills", "search");
    dragOver("skills", "search");

    expect(rowLabels()[0]).toBe("Skills");

    dragEnd("skills");

    expect(useSidebarStore.getState().navItemOrder[0]).toBe("skills");
  });

  it("a canceled drag drops the preview and leaves the store untouched", () => {
    renderDialog();

    dragStart("skills");
    dragOver("skills", "search");
    dragEnd("skills", { cancel: true });

    expect(rowLabels()[0]).toBe("Search");
    expect(useSidebarStore.getState().navItemOrder).toEqual([]);
    expect(track).not.toHaveBeenCalled();
  });

  it("a drop without movement neither persists nor tracks", () => {
    renderDialog();

    dragStart("skills");
    dragEnd("skills");

    expect(useSidebarStore.getState().navItemOrder).toEqual([]);
    expect(track).not.toHaveBeenCalled();
  });

  it("reset clears the stored order back to the default", async () => {
    const user = userEvent.setup();
    useSidebarStore.setState({ navItemOrder: ["loops", "search"] });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(useSidebarStore.getState().navItemOrder).toEqual([]);
    expect(rowLabels()[0]).toBe("Search");
  });
});
