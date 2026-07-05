export type OnboardingStep =
  | "welcome"
  | "project-select"
  | "invite-code"
  | "connect-github"
  | "install-cli"
  | "import-config"
  | "select-repo";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  "welcome",
  "project-select",
  "invite-code",
  "connect-github",
  "install-cli",
  "import-config",
  "select-repo",
];

export interface DetectedRepo {
  organization: string;
  repository: string;
  fullName: string;
  remote?: string;
  branch?: string;
}

export function computeActiveSteps(
  hasCodeAccess: boolean | null | undefined,
  hasImportableConfig: boolean,
): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((step) => {
    if (step === "invite-code" && hasCodeAccess === true) return false;
    if (step === "import-config" && !hasImportableConfig) return false;
    return true;
  });
}

export function stepIndexOf(
  activeSteps: OnboardingStep[],
  step: OnboardingStep,
): number {
  return activeSteps.indexOf(step);
}

export function isFirstStep(currentIndex: number): boolean {
  return currentIndex === 0;
}

export function isLastStep(
  activeSteps: OnboardingStep[],
  currentIndex: number,
): boolean {
  return currentIndex === activeSteps.length - 1;
}

export function nextStep(
  activeSteps: OnboardingStep[],
  currentIndex: number,
): OnboardingStep | null {
  if (isLastStep(activeSteps, currentIndex)) return null;
  return activeSteps[currentIndex + 1];
}

export function previousStep(
  activeSteps: OnboardingStep[],
  currentIndex: number,
): OnboardingStep | null {
  if (isFirstStep(currentIndex)) return null;
  return activeSteps[currentIndex - 1];
}

export function stepDirection(
  activeSteps: OnboardingStep[],
  currentIndex: number,
  target: OnboardingStep,
): 1 | -1 {
  const targetIndex = activeSteps.indexOf(target);
  return targetIndex >= currentIndex ? 1 : -1;
}
