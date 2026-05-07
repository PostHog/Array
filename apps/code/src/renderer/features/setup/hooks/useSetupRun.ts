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
  const wizardTaskId = useSetupStore((s) => s.wizardTaskId);
  const wizardSkipped = useSetupStore((s) => s.wizardSkipped);
  const wizardCompleted = useSetupStore((s) => s.wizardCompleted);
  const discoveryFeed = useSetupStore((s) => s.discoveryFeed);
  const wizardFeed = useSetupStore((s) => s.wizardFeed);
  const error = useSetupStore((s) => s.error);

  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (discoveryStatus === "done") return;
    if (!selectedDirectory) return;

    const service = get<SetupRunService>(RENDERER_TOKENS.SetupRunService);
    service.startWizard(selectedDirectory);
    service.startDiscovery(selectedDirectory);
  }, [discoveryStatus, selectedDirectory]);

  return {
    discoveryFeed,
    wizardFeed,
    isDiscoveryDone: discoveryStatus === "done",
    isWizardStarted: !!wizardTaskId,
    isWizardDone: wizardCompleted,
    wizardSkipped,
    discoveredTasks,
    wizardTaskId,
    error,
  };
}
