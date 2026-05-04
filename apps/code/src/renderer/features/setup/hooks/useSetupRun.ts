import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import type { SetupRunService } from "@features/setup/services/setupRunService";
import { useSetupStore } from "@features/setup/stores/setupStore";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { useEffect, useRef } from "react";

export function useSetupRun() {
  const selectedDirectory = useOnboardingStore((s) => s.selectedDirectory);
  const discoveryStatus = useSetupStore((s) => s.discoveryStatus);
  const discoveredTasks = useSetupStore((s) => s.discoveredTasks);
  const discoveryFeed = useSetupStore((s) => s.discoveryFeed);
  const error = useSetupStore((s) => s.error);

  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (discoveryStatus === "done") return;
    if (!selectedDirectory) return;

    const service = get<SetupRunService>(RENDERER_TOKENS.SetupRunService);
    service.startSetup(selectedDirectory);
  }, [discoveryStatus, selectedDirectory]);

  return {
    discoveryFeed,
    isDiscoveryDone: discoveryStatus === "done",
    discoveredTasks,
    error,
  };
}
