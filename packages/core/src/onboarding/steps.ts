export type OnboardingStep =
  | "welcome"
  | "project-select"
  | "invite-code"
  | "connect-github"
  | "install-cli"
  | "select-repo";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  "welcome",
  "project-select",
  "invite-code",
  "connect-github",
  "install-cli",
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
): OnboardingStep[] {
  if (hasCodeAccess === true) {
    return ONBOARDING_STEPS.filter((step) => step !== "invite-code");
  }
  return ONBOARDING_STEPS;
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
