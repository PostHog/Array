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
