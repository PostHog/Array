import { DotPatternBackground } from "@components/DotPatternBackground";
import { SuggestedTasks } from "@features/onboarding/components/context-collection/SuggestedTasks";
import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import { SetupScanFeed } from "@features/setup/components/SetupScanFeed";
import { useSetupRun } from "@features/setup/hooks/useSetupRun";
import { useSetupStore } from "@features/setup/stores/setupStore";
import type { DiscoveredTask } from "@features/setup/types";
import { buildDiscoveredTaskPrompt } from "@features/setup/utils/buildDiscoveredTaskPrompt";
import { useSetHeaderContent } from "@hooks/useSetHeaderContent";
import { Robot, Rocket } from "@phosphor-icons/react";
import { Box, Button, Flex, ScrollArea, Text } from "@radix-ui/themes";
import explorerHog from "@renderer/assets/images/hedgehogs/explorer-hog.png";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { useNavigationStore } from "@stores/navigationStore";
import { track } from "@utils/analytics";
import { motion } from "framer-motion";
import { useEffect } from "react";

export function SetupView() {
  const { discoveryFeed, isDiscoveryDone, discoveredTasks, error } =
    useSetupRun();
  const completeSetup = useOnboardingStore((state) => state.completeSetup);
  const navigateToTaskInput = useNavigationStore(
    (state) => state.navigateToTaskInput,
  );

  useSetHeaderContent(
    <Flex align="center" gap="2">
      <Rocket size={16} weight="duotone" />
      <Text size="2" weight="medium">
        {isDiscoveryDone ? "Tasks ready" : "Finish setup"}
      </Text>
    </Flex>,
  );

  useEffect(() => {
    track(ANALYTICS_EVENTS.SETUP_VIEWED, {
      discovery_status: useSetupStore.getState().discoveryStatus,
    });
  }, []);

  const handleSelectTask = (task: DiscoveredTask) => {
    const position = discoveredTasks.findIndex((t) => t.id === task.id);
    track(ANALYTICS_EVENTS.SETUP_TASK_SELECTED, {
      discovered_task_id: task.id,
      category: task.category,
      position: position >= 0 ? position : 0,
      total_discovered: discoveredTasks.length,
    });

    const initialPrompt = buildDiscoveredTaskPrompt(task);
    completeSetup();
    useSetupStore.getState().removeDiscoveredTask(task.id);
    navigateToTaskInput({ initialPrompt });
  };

  // Mid-scan: leave discovery running so the sidebar surfaces tasks when ready.
  const handleSkipDuringScan = () => {
    track(ANALYTICS_EVENTS.SETUP_SKIPPED, {
      discovery_status: useSetupStore.getState().discoveryStatus,
      had_discovered_tasks: discoveredTasks.length > 0,
      entry_point: "during_scan",
    });
    completeSetup();
    navigateToTaskInput();
  };

  const handleSkipAfterDone = () => {
    track(ANALYTICS_EVENTS.SETUP_SKIPPED, {
      discovery_status: useSetupStore.getState().discoveryStatus,
      had_discovered_tasks: discoveredTasks.length > 0,
      entry_point: "after_done",
    });
    useSetupStore.getState().resetDiscovery();
    completeSetup();
    navigateToTaskInput();
  };

  return (
    <ScrollArea scrollbars="vertical" className="relative h-full">
      <DotPatternBackground />
      <Flex
        align="center"
        justify="center"
        className="relative z-[1] min-h-full px-6 py-12"
      >
        <Flex
          direction="column"
          gap="5"
          className="w-full max-w-[520px] rounded-2xl border border-(--gray-a3) bg-(--color-background) px-7 py-6"
        >
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Flex direction="column" gap="2">
              <Text
                size="6"
                weight="bold"
                className="text-(--gray-12) leading-[1.3]"
              >
                {isDiscoveryDone
                  ? "Your starter tasks are ready"
                  : discoveredTasks.length > 0
                    ? "Some starter tasks are ready"
                    : "Finding your first tasks"}
              </Text>
              <Text size="2" className="text-(--gray-11)">
                {isDiscoveryDone
                  ? "Pick one to get going, or start from scratch — your suggestions stay in the sidebar."
                  : discoveredTasks.length > 0
                    ? "Pick one to get going, or wait — we're still skimming your codebase for more."
                    : "This takes about a minute. We're scanning your code for a handful of starter tasks you can run in one click — bug fixes, cleanup, and PostHog enhancements where they apply."}
              </Text>
            </Flex>
          </motion.div>

          <Flex direction="column" gap="3">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <SetupScanFeed
                label="Searching for your first tasks"
                icon={Robot}
                color="orange"
                currentTool={discoveryFeed.currentTool}
                recentEntries={discoveryFeed.recentEntries}
                isDone={isDiscoveryDone}
                doneLabel="Analysis complete"
              />
            </motion.div>
          </Flex>

          {discoveredTasks.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <Flex direction="column" gap="2">
                <Text size="3" weight="medium" className="text-(--gray-12)">
                  Recommended first tasks
                </Text>
                <SuggestedTasks
                  tasks={discoveredTasks}
                  onSelectTask={handleSelectTask}
                />
              </Flex>
            </motion.div>
          )}

          {!isDiscoveryDone && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
            >
              <Flex direction="column" gap="3">
                <Flex align="center" gap="3" py="1">
                  <motion.img
                    src={explorerHog}
                    alt=""
                    animate={{
                      y: [0, -3, 0],
                      transition: {
                        duration: 0.35,
                        repeat: Infinity,
                        repeatDelay: 0.15,
                      },
                    }}
                    className="h-9 w-9 shrink-0 object-contain"
                  />
                  <Text size="1" className="text-(--gray-9) italic">
                    {discoveredTasks.length > 0
                      ? "Looking for more starter tasks…"
                      : "Skimming your codebase for a few starter tasks…"}
                  </Text>
                </Flex>

                <Flex direction="column" gap="1" align="start">
                  <Button
                    size="2"
                    variant="ghost"
                    color="gray"
                    onClick={handleSkipDuringScan}
                  >
                    Start from scratch
                  </Button>
                  <Text size="1" className="text-(--gray-9)">
                    Suggested tasks will appear in the sidebar when ready.
                  </Text>
                </Flex>
              </Flex>
            </motion.div>
          )}

          {error && (
            <Text size="2" className="text-(--red-11)">
              {error}
            </Text>
          )}

          {isDiscoveryDone && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <Box>
                <Button
                  size="2"
                  variant="ghost"
                  color="gray"
                  onClick={handleSkipAfterDone}
                >
                  Start from scratch
                </Button>
              </Box>
            </motion.div>
          )}
        </Flex>
      </Flex>
    </ScrollArea>
  );
}
