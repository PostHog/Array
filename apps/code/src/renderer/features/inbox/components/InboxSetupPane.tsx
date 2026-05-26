import { Button } from "@components/ui/Button";
import { OnboardingHogTip } from "@features/onboarding/components/OnboardingHogTip";
import { SignalSourcesSettings } from "@features/settings/components/sections/SignalSourcesSettings";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";
import detectiveHog from "@renderer/assets/images/hedgehogs/detective-hog.png";
import { motion } from "framer-motion";

interface InboxSetupPaneProps {
  hasSignalSources: boolean;
  onProceedToInbox: () => void;
}

export function InboxSetupPane({
  hasSignalSources,
  onProceedToInbox,
}: InboxSetupPaneProps) {
  return (
    <Flex align="center" justify="center" height="100%" width="100%" px="6">
      <Flex
        direction="column"
        gap="2"
        className="w-full max-w-[720px] py-[24px]"
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Text className="font-bold text-(--gray-12) text-2xl">
            Set up self-driving for your product
          </Text>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <SignalSourcesSettings />
        </motion.div>

        <OnboardingHogTip
          hogSrc={detectiveHog}
          message="I'll investigate these sources around the clock and deliver tasks straight to your inbox when I find something worth acting on."
          delay={0.2}
        />

        <Flex justify="end" mt="2">
          <Button
            size="2"
            variant="soft"
            disabled={!hasSignalSources}
            disabledReason={
              hasSignalSources ? null : "Enable at least one source first"
            }
            onClick={onProceedToInbox}
          >
            Proceed to Inbox
            <ArrowRightIcon size={14} />
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}
