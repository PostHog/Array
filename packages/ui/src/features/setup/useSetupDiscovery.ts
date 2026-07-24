import { SetupRunService } from "@posthog/core/setup/setupRunService";
import { useService } from "@posthog/di/react";
import { DISCOVERY_RUN_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useEffect } from "react";
import { useActiveRepoStore } from "../../shell/activeRepoStore";
import { useHostCapabilities } from "../../shell/useHostCapabilities";

export function useSetupDiscovery() {
  const selectedDirectory = useActiveRepoStore((s) => s.path);
  const service = useService(SetupRunService);
  const discoveryEnabled = useFeatureFlag(DISCOVERY_RUN_FLAG);
  const { localWorkspaces } = useHostCapabilities();

  useEffect(() => {
    if (!localWorkspaces) return;
    if (!selectedDirectory) return;
    service.maybeStart(selectedDirectory, discoveryEnabled);
  }, [localWorkspaces, selectedDirectory, service, discoveryEnabled]);
}
