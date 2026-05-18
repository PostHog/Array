import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import type { SetupRunService } from "@features/setup/services/setupRunService";
import { useSetupStore } from "@features/setup/stores/setupStore";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { useEffect, useRef } from "react";

export function useSetupDiscovery() {
  const selectedDirectory = useOnboardingStore((s) => s.selectedDirectory);
  const discoveryStatus = useSetupStore((s) => s.discoveryStatus);

  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (discoveryStatus === "done") return;
    if (!selectedDirectory) return;

    startedRef.current = true;
    get<SetupRunService>(RENDERER_TOKENS.SetupRunService).startSetup(
      selectedDirectory,
    );
  }, [discoveryStatus, selectedDirectory]);
}
