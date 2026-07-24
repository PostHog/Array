import { PROJECT_BLUEBIRD_FLAG, SPACES_LAYOUT_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";

/**
 * The single gate for the Spaces layout. Off → the previous experience exactly
 * (the Code layout, and the old Channels alpha for users who had it toggled
 * on); on → the full Spaces experience. Every gate reads this hook, never the
 * raw flag, so the definition lives in one place.
 *
 * The spaces flag has no dev default — it's read from PostHog like a normal
 * flag so dev and production behave the same. Bluebird stays underneath as the
 * backend-availability guard and keeps its dev default so local channels work
 * is unaffected.
 */
export function useSpacesLayout(): boolean {
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const spacesEnabled = useFeatureFlag(SPACES_LAYOUT_FLAG, false);
  return spacesEnabled && bluebirdEnabled;
}
