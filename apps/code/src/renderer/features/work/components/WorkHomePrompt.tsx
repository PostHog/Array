import { useFolders } from "@features/folders/hooks/useFolders";
import { PromptInput } from "@features/message-editor/components/PromptInput";
import { ReasoningLevelSelector } from "@features/sessions/components/ReasoningLevelSelector";
import { UnifiedModelSelector } from "@features/sessions/components/UnifiedModelSelector";
import type { AgentAdapter } from "@features/settings/stores/settingsStore";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { usePreviewConfig } from "@renderer/features/task-detail/hooks/usePreviewConfig";
import type {
  TaskCreationInput,
  TaskService,
} from "@renderer/features/task-detail/service/service";
import { trpcClient } from "@renderer/trpc/client";
import { toast } from "@renderer/utils/toast";
import { useNavigationStore } from "@stores/navigationStore";
import { logger } from "@utils/logger";
import { useCallback, useState } from "react";

const log = logger.scope("work-home-prompt");

const WORK_HOME_SESSION_ID = "work-home";

async function resolveRepoPath(folders: string[]): Promise<string> {
  if (folders.length > 0) return folders[0];
  return trpcClient.os.getHomeDir.query();
}

export function WorkHomePrompt() {
  const navigateToWorkTask = useNavigationStore((s) => s.navigateToWorkTask);
  const { folders, isLoaded: foldersLoaded } = useFolders();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [adapter, setAdapter] = useState<AgentAdapter>("claude");
  const setLastUsedReasoningEffort = useSettingsStore(
    (s) => s.setLastUsedReasoningEffort,
  );
  const {
    modelOption,
    thoughtOption,
    isLoading: isPreviewLoading,
    setConfigOption,
  } = usePreviewConfig(adapter);

  const currentModel =
    modelOption?.type === "select" ? modelOption.currentValue : undefined;
  const currentReasoningLevel =
    thoughtOption?.type === "select" ? thoughtOption.currentValue : undefined;

  const handleModelChange = useCallback(
    (value: string) => {
      if (modelOption) {
        setConfigOption(modelOption.id, value);
      }
    },
    [modelOption, setConfigOption],
  );

  const handleThoughtChange = useCallback(
    (value: string) => {
      if (thoughtOption) {
        setConfigOption(thoughtOption.id, value);
        setLastUsedReasoningEffort(value);
      }
    },
    [thoughtOption, setConfigOption, setLastUsedReasoningEffort],
  );

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSubmitting || !foldersLoaded) return;

      setIsSubmitting(true);
      try {
        const folderPaths = folders.map((f) => f.path);
        const repoPath = await resolveRepoPath(folderPaths);

        const input: TaskCreationInput = {
          content: trimmed,
          repoPath,
          workspaceMode: "local",
          adapter,
          model: currentModel,
          reasoningLevel: currentReasoningLevel,
        };

        const taskService = get<TaskService>(RENDERER_TOKENS.TaskService);
        const result = await taskService.createTask(input, (output) => {
          navigateToWorkTask(output.task.id);
        });

        if (!result.success) {
          toast.error("Failed to start task", { description: result.error });
          log.error("Task creation failed", {
            failedStep: result.failedStep,
            error: result.error,
          });
        }
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "Unknown error";
        toast.error("Failed to start task", { description });
        log.error("Unexpected error during task creation", { error });
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      folders,
      foldersLoaded,
      isSubmitting,
      navigateToWorkTask,
      adapter,
      currentModel,
      currentReasoningLevel,
    ],
  );

  return (
    <PromptInput
      sessionId={WORK_HOME_SESSION_ID}
      placeholder="What should I take off your plate this week?"
      autoFocus
      clearOnSubmit
      editorHeight="large"
      enableCommands={false}
      enableBashMode={false}
      onSubmit={handleSubmit}
      modelSelector={
        <UnifiedModelSelector
          modelOption={modelOption}
          adapter={adapter}
          onAdapterChange={setAdapter}
          disabled={isSubmitting}
          isConnecting={isPreviewLoading}
          onModelChange={handleModelChange}
        />
      }
      reasoningSelector={
        !isPreviewLoading && (
          <ReasoningLevelSelector
            thoughtOption={thoughtOption}
            adapter={adapter}
            onChange={handleThoughtChange}
            disabled={isSubmitting}
          />
        )
      }
    />
  );
}
