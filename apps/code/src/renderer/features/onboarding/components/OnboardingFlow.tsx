import { FullScreenLayout } from "@components/FullScreenLayout";
import { useLogoutMutation } from "@features/auth/hooks/authMutations";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import { ArrowRight, SignOut } from "@phosphor-icons/react";
import { Button, Flex } from "@radix-ui/themes";
import { IS_DEV } from "@shared/constants/environment";
import { useNavigationStore } from "@stores/navigationStore";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useHotkeys } from "react-hotkeys-hook";

import { useOnboardingFlow } from "../hooks/useOnboardingFlow";
import { usePrefetchSignalData } from "../hooks/usePrefetchSignalData";
import { CliInstallStep } from "./CliInstallStep";
import { GitIntegrationStep } from "./GitIntegrationStep";
import { InviteCodeStep } from "./InviteCodeStep";
import { ProjectSelectStep } from "./ProjectSelectStep";
import { SignalsStep } from "./SignalsStep";
import { StepIndicator } from "./StepIndicator";
import { WelcomeScreen } from "./WelcomeScreen";

const stepVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 20 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -20 }),
};

export function OnboardingFlow() {
  const {
    currentStep,
    activeSteps,
    direction,
    next,
    back,
    selectedDirectory,
    detectedRepo,
    isDetectingRepo,
    handleDirectoryChange,
  } = useOnboardingFlow();
  const completeOnboarding = useOnboardingStore(
    (state) => state.completeOnboarding,
  );
  const hasCompletedSetup = useOnboardingStore(
    (state) => state.hasCompletedSetup,
  );
  const resetOnboarding = useOnboardingStore((state) => state.resetOnboarding);
  const navigateToSetup = useNavigationStore((state) => state.navigateToSetup);
  const logoutMutation = useLogoutMutation();
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated",
  );
  usePrefetchSignalData();

  useHotkeys("right", next, { enableOnFormTags: false }, [next]);
  useHotkeys("left", back, { enableOnFormTags: false }, [back]);

  const handleComplete = () => {
    completeOnboarding();
    if (!hasCompletedSetup) {
      navigateToSetup();
    }
  };

  const footerRight = (
    <Flex gap="5">
      {isAuthenticated && (
        <Button
          size="1"
          variant="ghost"
          color="gray"
          onClick={() => {
            logoutMutation.mutate();
            resetOnboarding();
          }}
          className="opacity-50"
        >
          <SignOut size={14} />
          Log out
        </Button>
      )}
      {IS_DEV && (
        <Button
          size="1"
          variant="ghost"
          color="gray"
          onClick={handleComplete}
          className="opacity-50"
        >
          <ArrowRight size={14} weight="bold" />
          Skip setup
        </Button>
      )}
    </Flex>
  );

  return (
    <FullScreenLayout footerRight={footerRight}>
      <LayoutGroup>
        <AnimatePresence mode="wait" custom={direction}>
          {currentStep === "welcome" && (
            <motion.div
              key="welcome"
              custom={direction}
              initial="enter"
              animate="center"
              exit="exit"
              variants={stepVariants}
              transition={{ duration: 0.3 }}
              className="min-h-0 w-full flex-1"
            >
              <WelcomeScreen onNext={next} />
            </motion.div>
          )}

          {currentStep === "project-select" && (
            <motion.div
              key="project-select"
              custom={direction}
              initial="enter"
              animate="center"
              exit="exit"
              variants={stepVariants}
              transition={{ duration: 0.3 }}
              className="min-h-0 w-full flex-1"
            >
              <ProjectSelectStep onNext={next} onBack={back} />
            </motion.div>
          )}

          {currentStep === "invite-code" && (
            <motion.div
              key="invite-code"
              custom={direction}
              initial="enter"
              animate="center"
              exit="exit"
              variants={stepVariants}
              transition={{ duration: 0.3 }}
              className="min-h-0 w-full flex-1"
            >
              <InviteCodeStep onNext={next} onBack={back} />
            </motion.div>
          )}

          {currentStep === "github" && (
            <motion.div
              key="github"
              custom={direction}
              initial="enter"
              animate="center"
              exit="exit"
              variants={stepVariants}
              transition={{ duration: 0.3 }}
              className="min-h-0 w-full flex-1"
            >
              <GitIntegrationStep
                onNext={next}
                onBack={back}
                selectedDirectory={selectedDirectory}
                detectedRepo={detectedRepo}
                isDetectingRepo={isDetectingRepo}
                onDirectoryChange={handleDirectoryChange}
              />
            </motion.div>
          )}

          {currentStep === "install-cli" && (
            <motion.div
              key="install-cli"
              custom={direction}
              initial="enter"
              animate="center"
              exit="exit"
              variants={stepVariants}
              transition={{ duration: 0.3 }}
              className="min-h-0 w-full flex-1"
            >
              <CliInstallStep onNext={next} onBack={back} />
            </motion.div>
          )}

          {currentStep === "signals" && (
            <motion.div
              key="signals"
              custom={direction}
              initial="enter"
              animate="center"
              exit="exit"
              variants={stepVariants}
              transition={{ duration: 0.3 }}
              className="min-h-0 w-full flex-1"
            >
              <SignalsStep onNext={handleComplete} onBack={back} />
            </motion.div>
          )}
        </AnimatePresence>

        <StepIndicator currentStep={currentStep} activeSteps={activeSteps} />
      </LayoutGroup>
    </FullScreenLayout>
  );
}
