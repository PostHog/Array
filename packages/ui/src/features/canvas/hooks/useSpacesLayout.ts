import { PROJECT_BLUEBIRD_FLAG, SPACES_LAYOUT_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";

/**
 * The single gate for the Spaces layout. Off → the previous experience exactly
 * (the Code layout, and the old Channels alpha for users who had it toggled
 * on); on → the full Spaces experience. Bluebird stays underneath as the
 * backend-availability guard. Every gate reads this hook, never the raw flag,
 * so the definition lives in one place.
 */
export function useSpacesLayout(): boolean {
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const spacesEnabled = useFeatureFlag(SPACES_LAYOUT_FLAG, import.meta.env.DEV);
  return spacesEnabled && bluebirdEnabled;
}
