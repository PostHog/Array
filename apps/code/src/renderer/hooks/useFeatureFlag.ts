import { isFeatureFlagEnabled, onFeatureFlagsLoaded } from "@utils/analytics";
import { useEffect, useState } from "react";

export function useFeatureFlag(
  flagKey: string,
  defaultValue: boolean = false,
): boolean {
  const [enabled, setEnabled] = useState(
    () => isFeatureFlagEnabled(flagKey) || defaultValue,
  );

  useEffect(() => {
    // Update immediately in case flags loaded between render and effect
    setEnabled(isFeatureFlagEnabled(flagKey) || defaultValue);

    // Subscribe to flag reloads (e.g. after identify, or periodic refresh)
    return onFeatureFlagsLoaded(() => {
      setEnabled(isFeatureFlagEnabled(flagKey) || defaultValue);
    });
  }, [flagKey, defaultValue]);

  return enabled;
}

/**
 * True once PostHog has resolved feature flags at least once (or immediately in
 * dev, where flags are short-circuited). Use this to defer flag-dependent
 * redirects until a flag's value is trustworthy, rather than acting on the
 * `false` default that every flag reports before load.
 */
export function useFeatureFlagsLoaded(): boolean {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // onFeatureFlagsLoaded fires immediately if flags are already resolved, so
    // a late mount still flips to true on the next tick.
    return onFeatureFlagsLoaded(() => setLoaded(true));
  }, []);

  return loaded;
}
