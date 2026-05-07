import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import { getSessionService } from "@features/sessions/service/service";
import {
  sessionStoreSetters,
  useSessionStore,
} from "@features/sessions/stores/sessionStore";
import type { Task } from "@shared/types";
import {
  enrichDescriptionWithFileContent,
  generateTitleAndSummary,
} from "@utils/generateTitle";
import { logger } from "@utils/logger";
import { getCachedTask, queryClient } from "@utils/queryClient";
import { extractUserPromptsFromEvents } from "@utils/session";
import { useEffect, useRef } from "react";

const log = logger.scope("chat-title-generator");

const REGENERATE_INTERVAL = 7;

export function useChatTitleGenerator(taskId: string): void {
  const lastGeneratedAtCount = useRef<number | null>(null);
  const isGenerating = useRef(false);

  const promptCount = useSessionStore((state) => {
    const taskRunId = state.taskIdIndex[taskId];
    if (!taskRunId) return 0;
    const session = state.sessions[taskRunId];
    if (!session?.events) return 0;
    return extractUserPromptsFromEvents(session.events).length;
  });

  useEffect(() => {
    if (promptCount === 0) return;
    if (isGenerating.current) return;

    if (lastGeneratedAtCount.current === null) {
      lastGeneratedAtCount.current = 0;
    }

    const shouldGenerate =
      (promptCount === 1 && lastGeneratedAtCount.current === 0) ||
      (promptCount > 1 &&
        promptCount - lastGeneratedAtCount.current >= REGENERATE_INTERVAL);

    if (!shouldGenerate) return;

    isGenerating.current = true;

    const state = useSessionStore.getState();
    const taskRunId = state.taskIdIndex[taskId];
    if (!taskRunId) {
      isGenerating.current = false;
      return;
    }
    const session = state.sessions[taskRunId];
    if (!session?.events) {
      isGenerating.current = false;
      return;
    }

    const allPrompts = extractUserPromptsFromEvents(session.events);
    const promptsForTitle =
      promptCount === 1 ? allPrompts : allPrompts.slice(-REGENERATE_INTERVAL);

    const rawContent = promptsForTitle
      .map((p, i) => `${i + 1}. ${p}`)
      .join("\n");

    const run = async () => {
      try {
        const content = await enrichDescriptionWithFileContent(rawContent);
        const result = await generateTitleAndSummary(content);
        if (result) {
          const { title, summary } = result;
          if (title) {
            const isFirstGeneration = lastGeneratedAtCount.current === 0;
            if (
              !isFirstGeneration &&
              getCachedTask(taskId)?.title_manually_set
            ) {
              log.debug("Skipping auto-title, user renamed task", { taskId });
              return;
            }
            const client = await getAuthenticatedClient();
            if (client) {
              await client.updateTask(taskId, { title });
              queryClient.setQueriesData<Task[]>(
                { queryKey: ["tasks", "list"] },
                (old) =>
                  old?.map((task) =>
                    task.id === taskId ? { ...task, title } : task,
                  ),
              );
              getSessionService().updateSessionTaskTitle(taskId, title);
              log.debug("Updated task title from conversation", {
                taskId,
                title,
                promptCount,
              });
            }
          }

          if (summary) {
            sessionStoreSetters.updateSession(taskRunId, {
              conversationSummary: result.summary,
            });

            log.debug("Updated task summary from conversation", {
              taskId,
              summary,
              promptCount,
            });
          }
        }
      } catch (error) {
        log.error("Failed to update task title", { taskId, error });
      } finally {
        lastGeneratedAtCount.current = promptCount;
        isGenerating.current = false;
      }
    };

    run();
  }, [promptCount, taskId]);
}
