import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@posthog/quill", () => ({
  Empty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  EmptyDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  EmptyHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  EmptyMedia: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  EmptyTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  Spinner: () => <div>Loading</div>,
}));
vi.mock("@posthog/ui/features/sidebar/components/SidebarItem", () => ({
  SidebarItem: () => <div>Recent item</div>,
}));
vi.mock("./useRecents", () => ({
  useRecents: () => ({
    data: [],
    error: new Error("backend unavailable"),
    isLoading: false,
  }),
}));

import { RecentsHoverCard } from "./RecentsHoverCard";

describe("RecentsHoverCard", () => {
  it("distinguishes a failed query from an empty history", () => {
    render(<RecentsHoverCard onClose={vi.fn()} />);

    expect(screen.getByText("Couldn't load recents")).toBeInTheDocument();
    expect(screen.queryByText("No recents yet")).not.toBeInTheDocument();
  });
});
