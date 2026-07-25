import { PROJECT_BLUEBIRD_FLAG, SPACES_LAYOUT_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";

/**
 * The single gate for the Spaces layout — every gate reads this hook, not the
 * raw flag. The spaces flag has no dev default (read from PostHog like normal,
 * so dev matches prod); bluebird keeps its dev default as the backend guard.
 */
export function useSpacesLayout(): boolean {
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const spacesEnabled = useFeatureFlag(SPACES_LAYOUT_FLAG, false);
  return spacesEnabled && bluebirdEnabled;
}
