import type { HomeWorkstream } from "@posthog/core/home/schemas";
import {
  REPORT_MODEL_RESOLVER,
  type ReportModelResolver,
} from "@posthog/core/inbox/identifiers";
import { TASK_SERVICE } from "@posthog/core/task-detail/identifiers";
import type { TaskService } from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import {
  ANALYTICS_EVENTS,
  getCloudUrlFromRegion,
  type TaskCreationInput,
} from "@posthog/shared";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { useUserRepositoryIntegration } from "@posthog/ui/features/integrations/useIntegrations";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { useConnectivity } from "@posthog/ui/hooks/useConnectivity";
import { toast } from "@posthog/ui/primitives/toast";
import { navigateToTaskPending } from "@posthog/ui/router/navigationBridge";
import { openTask, openTaskInput } from "@posthog/ui/router/useOpenTask";
import { track } from "@posthog/ui/shell/analytics";
import { logger } from "@posthog/ui/shell/logger";
import { pendingTaskPromptStoreApi } from "@posthog/ui/shell/pendingTaskPromptStore";
import { useCallback, useRef } from "react";
import type { BoundAction } from "./useBoundActions";

const log = logger.scope("home-quick-action");

// The agent runs the bound skill when the prompt starts with `/<skill-id>`, so
// embed it directly; the descriptive prompt follows as the instruction. With no
// skill bound, send the prompt on its own.
function buildSkillPrompt(action: BoundAction): string {
  const body = action.prompt.trim();
  const skillId = action.skillId.trim();
  if (!skillId) return body;
  const command = `/${skillId}`;
  return body ? `${command}\n\n${body}` : command;
}

/**
 * Runs a bound workflow action as a one-click cloud task: embeds the skill as a
 * `/<skill-id>` prefix and starts a cloud run on the workstream's repo + branch.
 * Falls back to the new-task screen (prompt prefilled) when it can't start
 * cleanly — offline, signed out, or the repo has no GitHub integration.
 */
export function useRunWorkstreamAction() {
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated",
  );
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const { isOnline } = useConnectivity();
  const { invalidateTasks } = useCreateTask();
  const { getUserIntegrationIdForRepo } = useUserRepositoryIntegration();
  const lastUsedAdapter = useSettingsStore((s) => s.lastUsedAdapter);
  const lastUsedModel = useSettingsStore((s) => s.lastUsedModel);
  const taskService = useService<TaskService>(TASK_SERVICE);
  const modelResolver = useService<ReportModelResolver>(REPORT_MODEL_RESOLVER);
  const inFlightRef = useRef(false);

  return useCallback(
    (action: BoundAction, workstream: HomeWorkstream) => {
      const promptText = buildSkillPrompt(action);
      // The GitHub integration map and cloud repo selector are keyed by the full
      // "org/repo" slug, so resolve from `repoFullPath`, not the bare `repoName`.
      const repo = workstream.repoFullPath?.toLowerCase() ?? null;
      const branch = workstream.branch ?? undefined;
      const githubUserIntegrationId = repo
        ? getUserIntegrationIdForRepo(repo)
        : undefined;

      const fallbackToTaskInput = () => {
        openTaskInput({
          initialPrompt: promptText,
          initialCloudRepository: repo ?? undefined,
        });
      };

      // One-click needs an online, authed session and a repo resolvable to a
      // GitHub integration; anything else routes to the new-task screen.
      const canOneClick =
        isAuthenticated && isOnline && !!repo && !!githubUserIntegrationId;
      if (!canOneClick) {
        fallbackToTaskInput();
        return;
      }

      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const pendingTaskKey =
        globalThis.crypto?.randomUUID?.() ?? `pending-${Date.now()}`;
      pendingTaskPromptStoreApi.set(pendingTaskKey, {
        promptText,
        attachments: [],
      });
      navigateToTaskPending(pendingTaskKey);

      void (async () => {
        try {
          // The cloud runtime requires a model: action-pinned, then last-used,
          // then the adapter's server default.
          const adapter = action.adapter ?? lastUsedAdapter;
          let model = action.model ?? lastUsedModel ?? undefined;
          if (!model && cloudRegion) {
            model = await modelResolver.resolveDefaultModel(
              getCloudUrlFromRegion(cloudRegion),
              adapter,
            );
          }
          if (!model) {
            pendingTaskPromptStoreApi.clear(pendingTaskKey);
            toast.error("Couldn't start task", {
              description:
                "No model is configured. Pick a model for this quick action.",
            });
            fallbackToTaskInput();
            return;
          }

          // `content` carries the skill prefix to the agent; `taskDescription`
          // is the clean prompt used for the task title and description.
          const input: TaskCreationInput = {
            content: promptText,
            taskDescription: action.prompt.trim() || action.label,
            repository: repo,
            workspaceMode: "cloud",
            branch,
            githubUserIntegrationId,
            adapter,
            model,
          };

          const result = await taskService.createTask(input, (output) => {
            invalidateTasks(output.task);
            pendingTaskPromptStoreApi.move(pendingTaskKey, output.task.id);
            void openTask(output.task);
          });

          if (result.success) {
            track(ANALYTICS_EVENTS.TASK_CREATED, {
              auto_run: false,
              created_from: "home-quick-action",
              repository_provider: "github",
              workspace_mode: "cloud",
              has_branch: !!branch,
              cloud_run_source: "manual",
              adapter,
            });
            return;
          }
          pendingTaskPromptStoreApi.clear(pendingTaskKey);
          toast.error("Failed to start task", { description: result.error });
          log.error("Quick action task creation failed", {
            failedStep: result.failedStep,
            error: result.error,
          });
          fallbackToTaskInput();
        } catch (error) {
          pendingTaskPromptStoreApi.clear(pendingTaskKey);
          const description =
            error instanceof Error ? error.message : "Unknown error";
          toast.error("Failed to start task", { description });
          log.error("Quick action task creation threw", { error });
          fallbackToTaskInput();
        } finally {
          inFlightRef.current = false;
        }
      })();
    },
    [
      isAuthenticated,
      isOnline,
      cloudRegion,
      invalidateTasks,
      getUserIntegrationIdForRepo,
      lastUsedAdapter,
      lastUsedModel,
      taskService,
      modelResolver,
    ],
  );
}
