import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { track } from "@posthog/ui/shell/analytics";
import { useEffect, useRef } from "react";

export interface TrackAgentsViewedInput {
  /** Gate the event until responder / integration / autonomy data has settled. */
  isLoading: boolean;
  hasGithubIntegration: boolean;
  responderTotalCount: number;
  responderEnabledCount: number;
  /** P0–P4, or null when the user's auto-start threshold is "Never". */
  autostartPriority: string | null;
  setupTaskAvailable: boolean;
}

/**
 * Fires `AGENTS_VIEWED` once per visit to the `/code/agents` configuration page,
 * after the responder/integration/autonomy data settles, with the state the user
 * sees on load. Mirrors `useTrackInboxViewed`; mounted from `ConfigureAgentsSection`
 * where the data already lives, so it fires once and survives re-renders.
 */
export function useTrackAgentsViewed(input: TrackAgentsViewedInput): void {
  const {
    isLoading,
    hasGithubIntegration,
    responderTotalCount,
    responderEnabledCount,
    autostartPriority,
    setupTaskAvailable,
  } = input;

  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    if (isLoading) return;
    firedRef.current = true;
    track(ANALYTICS_EVENTS.AGENTS_VIEWED, {
      has_github_integration: hasGithubIntegration,
      responder_total_count: responderTotalCount,
      responder_enabled_count: responderEnabledCount,
      autostart_priority: autostartPriority,
      setup_task_available: setupTaskAvailable,
    });
  }, [
    isLoading,
    hasGithubIntegration,
    responderTotalCount,
    responderEnabledCount,
    autostartPriority,
    setupTaskAvailable,
  ]);
}
