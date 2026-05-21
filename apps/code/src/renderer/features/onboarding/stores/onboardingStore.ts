import { logger } from "@utils/logger";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OnboardingStep } from "../types";

const log = logger.scope("onboarding-store");

interface OnboardingStoreState {
  currentStep: OnboardingStep;
  hasCompletedOnboarding: boolean;
  selectedProjectId: number | null;
  selectedDirectory: string;
}

interface OnboardingStoreActions {
  setCurrentStep: (step: OnboardingStep) => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
  resetSelections: () => void;
  selectProjectId: (projectId: number | null) => void;
  setSelectedDirectory: (path: string) => void;
}

type OnboardingStore = OnboardingStoreState & OnboardingStoreActions;

const initialState: OnboardingStoreState = {
  currentStep: "welcome",
  hasCompletedOnboarding: false,
  selectedProjectId: null,
  selectedDirectory: "",
};

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set) => ({
      ...initialState,

      setCurrentStep: (step) => set({ currentStep: step }),
      completeOnboarding: () => {
        log.info("completeOnboarding");
        set({ hasCompletedOnboarding: true });
      },
      resetOnboarding: () => set({ ...initialState }),
      resetSelections: () =>
        set({
          currentStep: "welcome",
          selectedProjectId: null,
        }),
      selectProjectId: (selectedProjectId) => set({ selectedProjectId }),
      setSelectedDirectory: (selectedDirectory) => set({ selectedDirectory }),
    }),
    {
      name: "onboarding-store",
      partialize: (state) => ({
        currentStep: state.currentStep,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        selectedProjectId: state.selectedProjectId,
        selectedDirectory: state.selectedDirectory,
      }),
    },
  ),
);
