import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { xmlToPlainText } from "@features/message-editor/utils/content";
import { getSessionService } from "@features/sessions/service/service";
import {
  sessionStoreSetters,
  useSessionStore,
} from "@features/sessions/stores/sessionStore";
import { taskKeys } from "@features/tasks/hooks/taskKeys";
import type { Schemas } from "@renderer/api/generated";
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

function getFallbackTaskTitle(description: string): string {
  const plainText = xmlToPlainText(description).trim();
  return (plainText || "Untitled").slice(0, 255);
}

function isPlaceholderTaskTitle(
  task: Pick<Task, "title" | "description">,
): boolean {
  if (task.title.trim().length === 0) {
    return true;
  }

  const fallbackTitle = getFallbackTaskTitle(task.description);
  return task.title === fallbackTitle;
}

function isAutoTitleLocked(task: Task | undefined): boolean {
  if (!task?.title_manually_set) {
    return false;
  }

  return !isPlaceholderTaskTitle(task);
}

export function useChatTitleGenerator(task: Task): void {
  const taskId = task.id;
  const lastGeneratedAtCount = useRef(0);
  const initialDescriptionHandled = useRef(false);
  const isGenerating = useRef(false);
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated" && !!state.cloudRegion,
  );

  const promptCount = useSessionStore((state) => {
    const taskRunId = state.taskIdIndex[taskId];
    if (!taskRunId) return 0;
    const session = state.sessions[taskRunId];
    if (!session?.events) return 0;
    return extractUserPromptsFromEvents(session.events).length;
  });

  useEffect(() => {
    if (!isAuthenticated) return;
    if (isGenerating.current) return;

    const shouldGenerateFromPrompts =
      (promptCount === 1 && lastGeneratedAtCount.current === 0) ||
      (promptCount > 1 &&
        promptCount - lastGeneratedAtCount.current >= REGENERATE_INTERVAL);

    const shouldGenerateFromTaskDescription =
      promptCount === 0 &&
      !initialDescriptionHandled.current &&
      task.description.trim().length > 0 &&
      isPlaceholderTaskTitle(task);

    if (!shouldGenerateFromPrompts && !shouldGenerateFromTaskDescription) {
      return;
    }

    isGenerating.current = true;

    const state = useSessionStore.getState();
    const taskRunId = state.taskIdIndex[taskId];
    const session = taskRunId ? state.sessions[taskRunId] : undefined;
    let rawContent = task.description;

    if (shouldGenerateFromPrompts) {
      if (!session?.events) {
        isGenerating.current = false;
        return;
      }

      const allPrompts = extractUserPromptsFromEvents(session.events);
      const promptsForTitle =
        promptCount === 1 ? allPrompts : allPrompts.slice(-REGENERATE_INTERVAL);

      rawContent = promptsForTitle.map((p, i) => `${i + 1}. ${p}`).join("\n");
    }

    const run = async () => {
      try {
        const content = await enrichDescriptionWithFileContent(rawContent);
        const result = await generateTitleAndSummary(content);
        if (result) {
          const { title, summary } = result;
          const titleLocked = isAutoTitleLocked(getCachedTask(taskId) ?? task);

          if (title && titleLocked) {
            log.debug("Skipping auto-title, user renamed task", { taskId });
          } else if (title) {
            const client = await getAuthenticatedClient();
            if (client) {
              await client.updateTask(taskId, { title });
              queryClient.setQueriesData<Task[]>(
                { queryKey: taskKeys.lists() },
                (old) =>
                  old?.map((task) =>
                    task.id === taskId ? { ...task, title } : task,
                  ),
              );
              queryClient.setQueriesData<Schemas.TaskSummary[]>(
                { queryKey: taskKeys.allSummaries() },
                (old) =>
                  old?.map((task) =>
                    task.id === taskId ? { ...task, title } : task,
                  ),
              );
              queryClient.setQueryData<Task>(taskKeys.detail(taskId), (old) =>
                old ? { ...old, title } : old,
              );
              getSessionService().updateSessionTaskTitle(taskId, title);
              log.debug("Updated task title from conversation", {
                taskId,
                promptCount,
              });
            }
          }

          if (summary && taskRunId) {
            sessionStoreSetters.updateSession(taskRunId, {
              conversationSummary: result.summary,
            });

            log.debug("Updated task summary from conversation", {
              taskId,
              promptCount,
            });
          }
        }
      } catch (error) {
        log.error("Failed to update task title", { taskId, error });
      } finally {
        if (shouldGenerateFromPrompts) {
          lastGeneratedAtCount.current = promptCount;
        }
        if (shouldGenerateFromTaskDescription) {
          initialDescriptionHandled.current = true;
        }
        isGenerating.current = false;
      }
    };

    run();
  }, [isAuthenticated, promptCount, taskId, task]);
}
