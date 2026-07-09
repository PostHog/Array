import { useFeatureFlag } from "../../feature-flags/useFeatureFlag";

export function useCloudModeEnabled(): boolean {
  return useFeatureFlag("twig-cloud-mode-toggle") || import.meta.env.DEV;
}
