import {
  SHOWCASE_CANVAS_NAME,
  SHOWCASE_SPEC,
} from "@posthog/ui/features/canvas/genui/showcaseSpec";
import {
  useDashboardMutations,
  useDashboards,
} from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useEffect, useRef } from "react";

// Seed the built-in "Dashboard component Showcase" canvas into a channel the
// first time its grid is opened, if it isn't already there. So a colleague who
// opens a channel always finds a working board demonstrating every component.
//
// Dedupe is two-layered: by name across sessions (the canvas already exists →
// skip) and by an in-session Set (claim the channel before the async create so
// a quick re-render can't fire a second create). It's a pure fixture seed — no
// domain decision — so it lives in the renderer where the spec does.
export function useSeedShowcase(channelId: string | undefined): void {
  const { dashboards, isLoading } = useDashboards(channelId);
  const { createDashboard } = useDashboardMutations();
  const claimed = useRef(new Set<string>());

  useEffect(() => {
    if (!channelId || isLoading || claimed.current.has(channelId)) return;
    if (dashboards.some((d) => d.name === SHOWCASE_CANVAS_NAME)) {
      claimed.current.add(channelId);
      return;
    }
    // Claim before the async create so a re-render mid-flight can't double-seed.
    claimed.current.add(channelId);
    createDashboard(
      channelId,
      SHOWCASE_CANVAS_NAME,
      SHOWCASE_SPEC,
      "dashboard",
    ).catch(() => {
      // Creation failed — release the claim so a later render can retry.
      claimed.current.delete(channelId);
    });
  }, [channelId, isLoading, dashboards, createDashboard]);
}
