import {
  buildTeamAvatarIndex,
  fetchTeamProfiles,
  type TeamAvatarIndex,
  type TeamAvatarUser,
  teamAvatarUrl,
} from "@posthog/core/canvas/teamProfiles";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { track } from "@posthog/ui/shell/analytics";
import { useQuery } from "@tanstack/react-query";

export const TEAM_AVATARS_QUERY_KEY = ["posthog-team-avatars"] as const;

// The roster is a static build artifact of posthog.com — one fetch per app
// session is plenty, and a failed fetch (offline, site drift) shouldn't retry
// under every avatar on screen.
const TEAM_AVATARS_GC_MS = 24 * 60 * 60 * 1000;

// The load event fires once per session, not once per mounted avatar.
let trackedLoad = false;

function useTeamAvatarIndex(): TeamAvatarIndex | null {
  const query = useQuery({
    queryKey: TEAM_AVATARS_QUERY_KEY,
    queryFn: async () => {
      const profiles = await fetchTeamProfiles();
      if (!trackedLoad) {
        trackedLoad = true;
        track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
          action_type: "load_team_avatars",
          surface: "channel_home",
          success: profiles.length > 0,
          profile_count: profiles.length,
        });
      }
      return buildTeamAvatarIndex(profiles);
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: TEAM_AVATARS_GC_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return query.data ?? null;
}

/**
 * The posthog.com/people photo for a teammate, or null while loading / when
 * there's no confident name match (callers keep their initials fallback).
 */
export function useTeamAvatarUrl(
  user: TeamAvatarUser | null | undefined,
): string | null {
  const index = useTeamAvatarIndex();
  return index ? teamAvatarUrl(index, user) : null;
}
