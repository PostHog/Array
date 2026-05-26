import { OnboardingHogTip } from "@features/onboarding/components/OnboardingHogTip";
import { SignalSourcesSettings } from "@features/settings/components/sections/SignalSourcesSettings";
import { Flex, Text } from "@radix-ui/themes";
import detectiveHog from "@renderer/assets/images/hedgehogs/detective-hog.png";
import { motion } from "framer-motion";

export function InboxSetupPane() {
  return (
    <Flex align="center" justify="center" height="100%" width="100%" px="6">
      <Flex
        direction="column"
        gap="5"
        className="w-full max-w-[720px] py-[24px]"
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Flex direction="column" gap="2">
            <Text className="font-bold text-(--gray-12) text-2xl">
              Set up your Signals Inbox
            </Text>
            <Text className="text-(--gray-11) text-sm">
              Connect GitHub and pick which sources to monitor. PostHog Code
              will analyze activity around the clock and surface ready-to-run
              fixes — with autonomous PRs at the priority threshold you choose.
            </Text>
          </Flex>
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
      </Flex>
    </Flex>
  );
}
