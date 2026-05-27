import { useUserGithubIntegrations } from "@hooks/useIntegrations";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Cloud,
  GitPullRequest,
} from "@phosphor-icons/react";
import { Button, Flex, Text } from "@radix-ui/themes";
import builderHog from "@renderer/assets/images/hedgehogs/builder-hog-03.png";
import type { OnboardingStepCompletedProperties } from "@shared/types/analytics";
import { motion } from "framer-motion";
import { GitHubConnectPanel } from "./GitHubConnectPanel";
import { OnboardingHogTip } from "./OnboardingHogTip";
import { OptionalBadge } from "./OptionalBadge";
import { StepActions } from "./StepActions";

type StepContext = Pick<OnboardingStepCompletedProperties, "github_connected">;

interface ConnectGitHubStepProps {
  onNext: (context?: StepContext) => void;
  onBack: () => void;
}

export function ConnectGitHubStep({ onNext, onBack }: ConnectGitHubStepProps) {
  const { data: githubUserIntegrations = [] } = useUserGithubIntegrations();
  const handleContinue = () => {
    onNext({ github_connected: githubUserIntegrations.length > 0 });
  };

  return (
    <Flex align="center" height="100%" px="8">
      <Flex
        direction="column"
        align="center"
        className="h-full w-full pt-[24px] pb-[40px]"
      >
        <Flex direction="column" className="min-h-0 flex-1 overflow-y-auto">
          <Flex
            direction="column"
            gap="5"
            className="m-auto w-full max-w-[560px]"
          >
            <Flex direction="column" gap="5" className="w-full">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Flex direction="column" gap="2">
                  <Flex align="center" gap="2">
                    <Text className="font-bold text-(--gray-12) text-2xl">
                      Connect GitHub
                    </Text>
                    <OptionalBadge />
                  </Flex>
                  <Text className="text-(--gray-11) text-sm">
                    Unlocks the parts of PostHog Code that leave your machine.
                  </Text>
                </Flex>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.03 }}
              >
                <Flex direction="column" gap="2">
                  <Flex align="center" gap="2">
                    <Cloud size={16} className="text-(--gray-11)" />
                    <Text className="text-(--gray-11) text-sm">
                      Run tasks in cloud sandboxes instead of your machine.
                    </Text>
                  </Flex>
                  <Flex align="center" gap="2">
                    <GitPullRequest size={16} className="text-(--gray-11)" />
                    <Text className="text-(--gray-11) text-sm">
                      Push branches and open pull requests from agents.
                    </Text>
                  </Flex>
                  <Flex align="center" gap="2">
                    <CheckCircle size={16} className="text-(--gray-11)" />
                    <Text className="text-(--gray-11) text-sm">
                      Review PR comments and reply to threads from inside the
                      app.
                    </Text>
                  </Flex>
                </Flex>
              </motion.div>

              <motion.div
                key="github-panel"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
              >
                <GitHubConnectPanel />
              </motion.div>
            </Flex>

            <OnboardingHogTip
              hogSrc={builderHog}
              message="You can skip this and still use local tasks. Come back any time to unlock cloud runs."
              delay={0.15}
            />
          </Flex>
        </Flex>

        <StepActions>
          <Button size="3" variant="outline" color="gray" onClick={onBack}>
            <ArrowLeft size={16} weight="bold" />
            Back
          </Button>
          <Button size="3" onClick={handleContinue}>
            Continue
            <ArrowRight size={16} weight="bold" />
          </Button>
        </StepActions>
      </Flex>
    </Flex>
  );
}
