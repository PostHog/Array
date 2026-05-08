import { DotPatternBackground } from "@components/DotPatternBackground";
import { SuggestedTasks } from "@features/onboarding/components/context-collection/SuggestedTasks";
import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import { SetupScanFeed } from "@features/setup/components/SetupScanFeed";
import { useSetupRun } from "@features/setup/hooks/useSetupRun";
import { useSetupStore } from "@features/setup/stores/setupStore";
import type { DiscoveredTask } from "@features/setup/types";
import { buildDiscoveredTaskPrompt } from "@features/setup/utils/buildDiscoveredTaskPrompt";
import { useSetHeaderContent } from "@hooks/useSetHeaderContent";
import {
  ArrowRight,
  Lightning,
  MagnifyingGlass,
  Rocket,
} from "@phosphor-icons/react";
import { Button, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { useNavigationStore } from "@stores/navigationStore";
import { track } from "@utils/analytics";
import { useEffect, useMemo } from "react";

export function SetupView() {
  const {
    discoveryFeed,
    isDiscoveryDone,
    isEnricherRunning,
    discoveredTasks,
    error,
  } = useSetupRun();
  const completeSetup = useOnboardingStore((state) => state.completeSetup);
  const navigateToTaskInput = useNavigationStore(
    (state) => state.navigateToTaskInput,
  );

  const { enricherTasks, agentTasks } = useMemo(() => {
    const enricher: DiscoveredTask[] = [];
    const agent: DiscoveredTask[] = [];
    for (const task of discoveredTasks) {
      if (task.source === "enricher") enricher.push(task);
      else agent.push(task);
    }
    return { enricherTasks: enricher, agentTasks: agent };
  }, [discoveredTasks]);

  const showQuickWins = enricherTasks.length > 0 || isEnricherRunning;
  const isEnricherDone = !isEnricherRunning;

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

  const handleStartFromScratch = () => {
    track(ANALYTICS_EVENTS.SETUP_SKIPPED, {
      discovery_status: useSetupStore.getState().discoveryStatus,
      had_discovered_tasks: discoveredTasks.length > 0,
      entry_point: isDiscoveryDone ? "after_done" : "during_scan",
    });
    if (isDiscoveryDone) {
      useSetupStore.getState().resetDiscovery();
    }
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
          className="w-full max-w-[760px] rounded-2xl border border-(--gray-a3) bg-(--color-background) px-7 py-6"
        >
          <Flex direction="column" gap="2">
            <Text
              size="6"
              weight="bold"
              className="text-(--gray-12) leading-[1.3]"
            >
              Set up your first task
            </Text>
            <Text size="2" className="text-(--gray-11)">
              Pick something to work on, or describe your own.
            </Text>
          </Flex>

          <div
            className={`grid grid-cols-1 items-start gap-5 ${
              showQuickWins ? "md:grid-cols-2" : ""
            }`}
          >
            {showQuickWins && (
              <QuickWinsColumn
                tasks={enricherTasks}
                isDone={isEnricherDone}
                onSelectTask={handleSelectTask}
              />
            )}

            <DeeperScanColumn
              hasSibling={showQuickWins}
              isDone={isDiscoveryDone}
              tasks={agentTasks}
              feed={discoveryFeed}
              error={error}
              onSelectTask={handleSelectTask}
            />
          </div>

          <Flex
            direction="column"
            gap="2"
            align="stretch"
            className="border-(--gray-a3) border-t pt-4"
          >
            <Button size="3" variant="solid" onClick={handleStartFromScratch}>
              <Flex align="center" gap="2" justify="center">
                <Text size="2" weight="medium">
                  Or describe your own task
                </Text>
                <ArrowRight size={14} weight="bold" />
              </Flex>
            </Button>
            {!isDiscoveryDone && (
              <Text size="1" className="text-center text-(--gray-9)">
                Suggested tasks will appear in the sidebar as they're ready.
              </Text>
            )}
          </Flex>
        </Flex>
      </Flex>
    </ScrollArea>
  );
}

interface QuickWinsColumnProps {
  tasks: DiscoveredTask[];
  isDone: boolean;
  onSelectTask: (task: DiscoveredTask) => void;
}

function QuickWinsColumn({
  tasks,
  isDone,
  onSelectTask,
}: QuickWinsColumnProps) {
  return (
    <Flex direction="column" gap="3">
      <Flex direction="column" gap="1">
        <Text size="2" weight="medium" className="text-(--gray-12)">
          Quick wins
        </Text>
        <Text size="1" className="text-(--gray-10)">
          Spotted in your PostHog setup
        </Text>
      </Flex>
      <SetupScanFeed
        label="Quick wins"
        icon={Lightning}
        color="amber"
        currentTool={null}
        activeLabelOverride="Checking your PostHog setup…"
        recentEntries={[]}
        isDone={isDone}
        doneLabel="Ready"
      />
      {tasks.length > 0 && (
        <SuggestedTasks
          tasks={tasks}
          onSelectTask={onSelectTask}
          variant="compact"
        />
      )}
    </Flex>
  );
}

interface DeeperScanColumnProps {
  hasSibling: boolean;
  isDone: boolean;
  tasks: DiscoveredTask[];
  feed: ReturnType<typeof useSetupRun>["discoveryFeed"];
  error: string | null;
  onSelectTask: (task: DiscoveredTask) => void;
}

function DeeperScanColumn({
  hasSibling,
  isDone,
  tasks,
  feed,
  error,
  onSelectTask,
}: DeeperScanColumnProps) {
  const isEmpty = isDone && tasks.length === 0;

  return (
    <div
      className={
        hasSibling ? "md:border-(--gray-a3) md:border-l md:pl-5" : undefined
      }
    >
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="1">
          <Text size="2" weight="medium" className="text-(--gray-12)">
            Deeper scan
          </Text>
          <Text size="1" className="text-(--gray-10)">
            {isDone
              ? "We checked your code for bugs and improvements."
              : "Bugs, dead code, and improvements (~1 min)."}
          </Text>
        </Flex>
        <SetupScanFeed
          label="Deeper scan"
          icon={MagnifyingGlass}
          color="orange"
          currentTool={feed.currentTool}
          recentEntries={feed.recentEntries}
          isDone={isDone}
          doneLabel="Analysis complete"
        />

        {isDone && tasks.length > 0 && (
          <SuggestedTasks
            tasks={tasks}
            onSelectTask={onSelectTask}
            variant="compact"
          />
        )}

        {isEmpty && !error && (
          <Flex
            align="center"
            justify="center"
            py="4"
            className="rounded-xl border border-(--gray-a3) border-dashed text-(--gray-10)"
          >
            <Text size="2">No issues found — your code looks clean ✨</Text>
          </Flex>
        )}

        {error && (
          <Text size="2" className="text-(--red-11)">
            {error}
          </Text>
        )}
      </Flex>
    </div>
  );
}
