import { ArrowRightIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { motion } from "framer-motion";
import { SignalSourcesSettings } from "../../settings/sections/SignalSourcesSettings";

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

        <Flex justify="end" mt="2">
          {hasSignalSources ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onProceedToInbox}
            >
              Proceed to Inbox
              <ArrowRightIcon size={14} />
            </Button>
          ) : (
            <Tooltip content="Enable at least one source first">
              <span className="inline-flex cursor-not-allowed">
                <Button type="button" variant="primary" size="sm" disabled>
                  Proceed to Inbox
                  <ArrowRightIcon size={14} />
                </Button>
              </span>
            </Tooltip>
          )}
        </Flex>
      </Flex>
    </Flex>
  );
}
