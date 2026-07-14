import { useRouteContext } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { create } from "zustand";

// Header content is keyed by PANE: every pane hosts its own router (tab-owned
// split panes), and each pane's scene pushes its own breadcrumb. A single
// global slot would make every pane's header bar render the last writer's
// content (and an unmounting pane's cleanup would wipe a sibling's header).
interface HeaderStore {
  contentByPane: Record<string, ReactNode>;
  setContent: (paneId: string, content: ReactNode) => void;
}

export const useHeaderStore = create<HeaderStore>((set) => ({
  contentByPane: {},
  setContent: (paneId, content) =>
    set((state) => {
      if (content == null) {
        if (!(paneId in state.contentByPane)) return state;
        const { [paneId]: _removed, ...rest } = state.contentByPane;
        return { contentByPane: rest };
      }
      return { contentByPane: { ...state.contentByPane, [paneId]: content } };
    }),
}));

/** The pane this component renders in — from the pane router's root context.
 * Null outside a pane router (unit tests, Storybook). */
export function usePaneId(): string | null {
  const context = useRouteContext({ strict: false }) as {
    paneId?: string;
  } | null;
  return context?.paneId ?? null;
}

/** This pane's header content (the "# channel / leaf" breadcrumb its scene
 * pushed), resolved against the calling component's own pane router. */
export function usePaneHeaderContent(): ReactNode {
  const paneId = usePaneId();
  return useHeaderStore((state) =>
    paneId ? (state.contentByPane[paneId] ?? null) : null,
  );
}
