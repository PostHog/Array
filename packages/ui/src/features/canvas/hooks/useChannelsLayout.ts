import { CHANNELS_LAYOUT_FLAG, PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";

/**
 * The single gate for the new channels layout — every gate reads this hook,
 * not the raw flag. No dev default (read from PostHog like normal, so dev
 * matches prod); bluebird keeps its dev default as the backend guard.
 */
export function useChannelsLayout(): boolean {
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const layoutEnabled = useFeatureFlag(CHANNELS_LAYOUT_FLAG, false);
  return layoutEnabled && bluebirdEnabled;
}
