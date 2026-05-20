import type { SetupRunService } from "@features/setup/services/setupRunService";
import {
  selectRepoDiscovery,
  useSetupStore,
} from "@features/setup/stores/setupStore";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { useActiveRepoStore } from "@stores/activeRepoStore";
import { useEffect } from "react";

export function useSetupDiscovery() {
  const selectedDirectory = useActiveRepoStore((s) => s.path);
  const discoveryStatus = useSetupStore(
    (s) => selectRepoDiscovery(s, selectedDirectory).status,
  );
  const discoveryEverStarted = useSetupStore((s) =>
    Object.values(s.discoveryByRepo).some((d) => d.status !== "idle"),
  );

  useEffect(() => {
    if (!selectedDirectory) return;
    const service = get<SetupRunService>(RENDERER_TOKENS.SetupRunService);

    if (discoveryEverStarted) {
      service.startEnricherForRepo(selectedDirectory);
      return;
    }

    if (discoveryStatus === "running" || discoveryStatus === "done") {
      service.startEnricherForRepo(selectedDirectory);
      return;
    }
    service.startSetup(selectedDirectory);
  }, [discoveryEverStarted, discoveryStatus, selectedDirectory]);
}
