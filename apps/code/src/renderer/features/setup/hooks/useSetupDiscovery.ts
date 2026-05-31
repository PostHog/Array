import type { SetupRunService } from "@features/setup/services/setupRunService";
import { useSetupStore } from "@features/setup/stores/setupStore";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { useActiveRepoStore } from "@stores/activeRepoStore";
import { useEffect } from "react";

const SIMULATE_SUGGESTIONS_STORAGE_KEY = "posthog-code:simulate-suggestions";

function shouldSimulateSuggestions(): boolean {
  if (!import.meta.env.DEV) return false;
  if (import.meta.env.VITE_SIMULATE_SUGGESTIONS === "1") return true;
  return window.localStorage.getItem(SIMULATE_SUGGESTIONS_STORAGE_KEY) === "1";
}

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
    if (shouldSimulateSuggestions()) {
      service.startSuggestionSimulation(selectedDirectory);
      return;
    }

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
