import type { SetupRunService } from "@features/setup/services/setupRunService";
import { useSetupStore } from "@features/setup/stores/setupStore";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { useActiveRepoStore } from "@stores/activeRepoStore";
import { useEffect } from "react";

export function useSetupDiscovery() {
  const selectedDirectory = useActiveRepoStore((s) => s.path);

  // Discovery is a one-time-per-user agent run; once any repo has triggered
  // it we never auto-launch another one from this hook. Errored/interrupted
  // runs require explicit user retry (see setupStore partialize and #2257).
  // Enricher runs per repo on every selection (gated on per-repo status
  // inside the service).
  useEffect(() => {
    if (!selectedDirectory) return;
    const service = get<SetupRunService>(RENDERER_TOKENS.SetupRunService);
    const discoveryEverStarted = Object.values(
      useSetupStore.getState().discoveryByRepo,
    ).some((d) => d.status !== "idle");
    if (discoveryEverStarted) {
      service.startEnricherForRepo(selectedDirectory);
    } else {
      service.startSetup(selectedDirectory);
    }
  }, [selectedDirectory]);
}
