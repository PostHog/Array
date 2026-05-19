import { DataSourceSetup } from "@features/inbox/components/DataSourceSetup";
import { SignalSourceToggles } from "@features/inbox/components/SignalSourceToggles";
import { useSignalSourceManager } from "@features/inbox/hooks/useSignalSourceManager";
import { useMeQuery } from "@hooks/useMeQuery";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { Button, Flex, Text } from "@radix-ui/themes";
import detectiveHog from "@renderer/assets/images/hedgehogs/detective-hog.png";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { OnboardingHogTip } from "./OnboardingHogTip";
import { StepActions } from "./StepActions";

interface SignalsStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function SignalsStep({ onNext, onBack }: SignalsStepProps) {
  const queryClient = useQueryClient();
  const {
    displayValues,
    sourceStates,
    setupSource,
    isLoading,
    handleToggle,
    handleSetup,
    handleSetupComplete,
    handleSetupCancel,
    evaluationsUrl,
  } = useSignalSourceManager();
  const { data: me } = useMeQuery();
  const isStaff = me?.is_staff ?? false;

  const anyEnabled =
    displayValues.session_replay ||
    displayValues.error_tracking ||
    displayValues.github ||
    displayValues.linear ||
    displayValues.zendesk;

  const handleContinue = async (): Promise<void> => {
    if (anyEnabled) {
      await queryClient.invalidateQueries({
        queryKey: ["inbox", "signal-reports"],
      });
    }
    onNext();
  };

  return (
    <Flex align="center" height="100%" px="8">
      <Flex
        direction="column"
        align="center"
        className="h-full w-full pt-[24px] pb-[40px]"
      >
        <Flex
          direction="column"
          className="min-h-0 w-full flex-1 overflow-y-auto"
        >
          <Flex
            direction="column"
            gap="5"
            style={{
              margin: "auto auto",
            }}
            className="w-full max-w-[720px] px-0 py-[16px]"
          >
            {/* Header + content */}
            <Flex direction="column" gap="5" className="w-full">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Flex direction="column" gap="3">
                  <Text className="font-bold text-(--gray-12) text-2xl">
                    Set up your Signals Inbox
                  </Text>
                  <Text className="text-(--gray-11) text-sm">
                    Choose which sources to monitor for this project. Signals
                    will analyze activity and prioritize what needs attention.
                  </Text>
                </Flex>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
              >
                {setupSource ? (
                  <DataSourceSetup
                    source={setupSource}
                    onComplete={() => void handleSetupComplete()}
                    onCancel={handleSetupCancel}
                  />
                ) : (
                  <SignalSourceToggles
                    value={displayValues}
                    onToggle={(source, enabled) =>
                      void handleToggle(source, enabled)
                    }
                    disabled={isLoading}
                    sourceStates={sourceStates}
                    onSetup={handleSetup}
                    evaluationsUrl={isStaff ? evaluationsUrl : undefined}
                  />
                )}
              </motion.div>
            </Flex>

            {/* Hog tip */}
            <OnboardingHogTip
              hogSrc={detectiveHog}
              message="I'll investigate these sources around the clock and deliver tasks straight to your inbox when I find something worth acting on."
              delay={0.2}
            />
          </Flex>
        </Flex>

        <StepActions delay={0.25}>
          <Button
            size="3"
            variant="outline"
            color="gray"
            onClick={onBack}
            disabled={isLoading}
          >
            <ArrowLeft size={16} weight="bold" />
            Back
          </Button>
          {anyEnabled ? (
            <Button
              size="3"
              onClick={() => void handleContinue()}
              disabled={isLoading}
            >
              Continue to setup
              <ArrowRight size={16} weight="bold" />
            </Button>
          ) : (
            <Button
              size="3"
              variant="outline"
              color="gray"
              onClick={onNext}
              disabled={isLoading}
            >
              Skip for now
              <ArrowRight size={16} weight="bold" />
            </Button>
          )}
        </StepActions>
      </Flex>
    </Flex>
  );
}
