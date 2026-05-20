import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import { trpcClient } from "@renderer/trpc/client";
import {
  ANALYTICS_EVENTS,
  type RepositoryProvider,
} from "@shared/types/analytics";
import { useActiveRepoStore } from "@stores/activeRepoStore";
import { track } from "@utils/analytics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ONBOARDING_STEPS, type OnboardingStep } from "../types";

function inferRepositoryProvider(
  remote: string | undefined,
): RepositoryProvider {
  if (!remote) return "local";
  const host = remote
    .match(/^(?:[a-z]+:\/\/)?(?:[^@/]+@)?([a-z0-9.-]+)[:/]/i)?.[1]
    ?.toLowerCase();
  if (host === "gitlab.com") return "gitlab";
  if (host === "github.com") return "github";
  return "none";
}

export interface DetectedRepo {
  organization: string;
  repository: string;
  fullName: string;
  remote?: string;
  branch?: string;
}

export function useOnboardingFlow() {
  const currentStep = useOnboardingStore((state) => state.currentStep);
  const setCurrentStep = useOnboardingStore((state) => state.setCurrentStep);
  const selectedDirectory = useActiveRepoStore((state) => state.path);
  const setSelectedDirectory = useActiveRepoStore((state) => state.setPath);
  const directionRef = useRef<1 | -1>(1);

  const [detectedRepo, setDetectedRepo] = useState<DetectedRepo | null>(null);
  const [isDetectingRepo, setIsDetectingRepo] = useState(false);
  const hasRehydrated = useRef(false);

  useEffect(() => {
    if (hasRehydrated.current || !selectedDirectory) return;
    hasRehydrated.current = true;
    setIsDetectingRepo(true);
    trpcClient.git.detectRepo
      .query({ directoryPath: selectedDirectory })
      .then((result) => {
        if (result) {
          setDetectedRepo({
            organization: result.organization,
            repository: result.repository,
            fullName: `${result.organization}/${result.repository}`,
            remote: result.remote ?? undefined,
            branch: result.branch ?? undefined,
          });
        }
      })
      .catch(() => {})
      .finally(() => setIsDetectingRepo(false));
  }, [selectedDirectory]);

  const handleDirectoryChange = useCallback(
    async (path: string) => {
      setSelectedDirectory(path);
      setDetectedRepo(null);
      if (!path) return;

      setIsDetectingRepo(true);
      try {
        const result = await trpcClient.git.detectRepo.query({
          directoryPath: path,
        });
        if (result) {
          setDetectedRepo({
            organization: result.organization,
            repository: result.repository,
            fullName: `${result.organization}/${result.repository}`,
            remote: result.remote ?? undefined,
            branch: result.branch ?? undefined,
          });
          track(ANALYTICS_EVENTS.ONBOARDING_FOLDER_SELECTED, {
            has_git_remote: true,
            repository_provider: inferRepositoryProvider(
              result.remote ?? undefined,
            ),
          });
        } else {
          track(ANALYTICS_EVENTS.ONBOARDING_FOLDER_SELECTED, {
            has_git_remote: false,
            repository_provider: "local",
          });
        }
      } catch {
        track(ANALYTICS_EVENTS.ONBOARDING_FOLDER_SELECTED, {
          has_git_remote: false,
          repository_provider: "local",
        });
      } finally {
        setIsDetectingRepo(false);
      }
    },
    [setSelectedDirectory],
  );

  const hasCodeAccess = useAuthStateValue((state) => state.hasCodeAccess);

  const activeSteps = useMemo(() => {
    if (hasCodeAccess === true) {
      return ONBOARDING_STEPS.filter((s) => s !== "invite-code");
    }
    return ONBOARDING_STEPS;
  }, [hasCodeAccess]);

  useEffect(() => {
    if (!activeSteps.includes(currentStep)) {
      setCurrentStep(activeSteps[0]);
    }
  }, [activeSteps, currentStep, setCurrentStep]);

  const currentIndex = activeSteps.indexOf(currentStep);
  const isFirstStep = currentIndex === 0;
  const isLastStep = currentIndex === activeSteps.length - 1;

  const next = () => {
    if (!isLastStep) {
      directionRef.current = 1;
      setCurrentStep(activeSteps[currentIndex + 1]);
    }
  };

  const back = () => {
    if (!isFirstStep) {
      directionRef.current = -1;
      setCurrentStep(activeSteps[currentIndex - 1]);
    }
  };

  const goTo = (step: OnboardingStep) => {
    const targetIndex = activeSteps.indexOf(step);
    directionRef.current = targetIndex >= currentIndex ? 1 : -1;
    setCurrentStep(step);
  };

  return {
    currentStep,
    currentIndex,
    totalSteps: activeSteps.length,
    activeSteps,
    isFirstStep,
    isLastStep,
    direction: directionRef.current,
    next,
    back,
    goTo,
    selectedDirectory,
    detectedRepo,
    isDetectingRepo,
    handleDirectoryChange,
  };
}
