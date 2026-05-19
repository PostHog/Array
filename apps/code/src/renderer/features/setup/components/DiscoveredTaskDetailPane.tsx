import { Badge } from "@components/ui/Badge";
import { MarkdownRenderer } from "@features/editor/components/MarkdownRenderer";
import { useFolders } from "@features/folders/hooks/useFolders";
import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import { useSetupStore } from "@features/setup/stores/setupStore";
import type { DiscoveredTask } from "@features/setup/types";
import { buildDiscoveredTaskPrompt } from "@features/setup/utils/buildDiscoveredTaskPrompt";
import {
  CATEGORY_CONFIG,
  FALLBACK_CATEGORY_CONFIG,
} from "@features/setup/utils/categoryConfig";
import { useDetectedCloudRepository } from "@hooks/useDetectedCloudRepository";
import { PlusIcon, SparkleIcon, X as XIcon } from "@phosphor-icons/react";
import { Box, Button, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { useNavigationStore } from "@stores/navigationStore";
import { track } from "@utils/analytics";

interface DiscoveredTaskDetailPaneProps {
  task: DiscoveredTask;
  onClose: () => void;
}

export function DiscoveredTaskDetailPane({
  task,
  onClose,
}: DiscoveredTaskDetailPaneProps) {
  const config = CATEGORY_CONFIG[task.category] ?? FALLBACK_CATEGORY_CONFIG;
  const CategoryIcon = config.icon;

  const tasks = useSetupStore((s) => s.discoveredTasks);
  const selectedDirectory = useOnboardingStore((s) => s.selectedDirectory);
  const completeSetup = useOnboardingStore((s) => s.completeSetup);
  const navigateToTaskInput = useNavigationStore((s) => s.navigateToTaskInput);
  const { folders } = useFolders();
  const detectedCloudRepository = useDetectedCloudRepository(selectedDirectory);

  const handleCreateTask = () => {
    const position = tasks.findIndex((t) => t.id === task.id);
    track(ANALYTICS_EVENTS.SETUP_TASK_SELECTED, {
      discovered_task_id: task.id,
      category: task.category,
      position: position >= 0 ? position : 0,
      total_discovered: tasks.length,
    });

    const initialPrompt = buildDiscoveredTaskPrompt(task);
    const folderId = folders.find((f) => f.path === selectedDirectory)?.id;
    completeSetup();
    useSetupStore.getState().removeDiscoveredTask(task.id);
    navigateToTaskInput({
      initialPrompt,
      folderId,
      initialCloudRepository: detectedCloudRepository ?? undefined,
    });
  };

  const handleDismiss = () => {
    const position = tasks.findIndex((t) => t.id === task.id);
    track(ANALYTICS_EVENTS.SETUP_TASK_DISMISSED, {
      discovered_task_id: task.id,
      category: task.category,
      position: position >= 0 ? position : 0,
      total_discovered: tasks.length,
    });
    useSetupStore.getState().removeDiscoveredTask(task.id);
  };

  return (
    <>
      <Flex
        align="center"
        justify="between"
        gap="2"
        py="2"
        className="shrink-0 border-b border-b-(--gray-5) @2xl:px-6 @3xl:px-8 @4xl:px-10 @5xl:px-12 @lg:px-4 @md:px-3 @xl:px-5 px-2"
      >
        <Flex align="center" gap="2" className="min-w-0">
          <Badge
            color="violet"
            className="!leading-none inline-flex shrink-0 items-center gap-1"
          >
            <SparkleIcon size={10} weight="fill" />
            Suggested
          </Badge>
          <Text className="block min-w-0 text-balance break-words font-bold text-base">
            {task.title}
          </Text>
        </Flex>
        <Flex align="center" gap="1" className="shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close suggestion"
            className="rounded p-0.5 text-gray-11 hover:bg-gray-3 hover:text-gray-12"
          >
            <XIcon size={14} />
          </button>
        </Flex>
      </Flex>

      <ScrollArea type="auto" scrollbars="vertical" className="min-h-0 flex-1">
        <Flex
          direction="column"
          gap="4"
          className="@2xl:px-6 @3xl:px-8 @4xl:px-10 @5xl:px-12 @lg:px-4 @md:px-3 @xl:px-5 px-2 py-4"
        >
          <Flex align="center" gap="2" className="text-(--gray-11)">
            <span style={{ color: `var(--${config.color}-9)` }}>
              <CategoryIcon size={14} weight="duotone" />
            </span>
            <Text size="1" className="uppercase tracking-wide">
              {config.label}
            </Text>
            {task.file && (
              <>
                <Text size="1" className="text-(--gray-8)">
                  ·
                </Text>
                <Text size="1" className="break-all font-mono">
                  {task.file}
                  {task.lineHint ? `:${task.lineHint}` : ""}
                </Text>
              </>
            )}
          </Flex>

          <ProseSection content={task.description} />

          {task.impact && (
            <Box>
              <Text
                size="1"
                weight="medium"
                className="mb-1 block text-(--gray-11) uppercase tracking-wide"
              >
                Why it matters
              </Text>
              <ProseSection content={task.impact} />
            </Box>
          )}

          {task.recommendation && (
            <Box>
              <Text
                size="1"
                weight="medium"
                className="mb-1 block text-(--gray-11) uppercase tracking-wide"
              >
                Suggested approach
              </Text>
              <ProseSection content={task.recommendation} />
            </Box>
          )}

          <Text size="1" className="text-(--gray-10) italic">
            Suggested locally from a quick scan of your codebase. Open it as a
            task to investigate and fix.
          </Text>
        </Flex>
      </ScrollArea>

      <Flex
        align="center"
        justify="end"
        gap="2"
        className="h-[38px] shrink-0 border-t border-t-(--gray-5) bg-(--gray-1) @2xl:px-6 @3xl:px-8 @4xl:px-10 @5xl:px-12 @lg:px-4 @md:px-3 @xl:px-5 px-2"
      >
        <Button
          size="1"
          variant="ghost"
          color="gray"
          className="gap-1 font-medium text-[11px]"
          onClick={handleDismiss}
        >
          Dismiss
        </Button>
        <Button
          size="1"
          variant="solid"
          className="gap-1 font-medium text-[11px]"
          onClick={handleCreateTask}
        >
          <PlusIcon size={12} />
          Implement as new task
        </Button>
      </Flex>
    </>
  );
}

function ProseSection({ content }: { content: string }) {
  return (
    <Box className="min-w-0 text-pretty break-words text-(--gray-12) text-[13px] [&_*]:leading-relaxed [&_a]:pointer-events-auto [&_code]:font-mono [&_li]:mb-1 [&_p:last-child]:mb-0 [&_p]:mb-2">
      <MarkdownRenderer content={content} />
    </Box>
  );
}
