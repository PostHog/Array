import type { HomeSnapshot, HomeWorkstream } from "@posthog/core/home/schemas";
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
import { homeKeys } from "@posthog/ui/features/home/hooks/useHomeSnapshot";
import { useQuickActionStore } from "@posthog/ui/features/home/stores/quickActionStore";
import { insertOptimisticTask } from "@posthog/ui/features/home/utils/optimisticTask";
import { useUserRepositoryIntegration } from "@posthog/ui/features/integrations/useIntegrations";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useConnectivity } from "@posthog/ui/hooks/useConnectivity";
import { toast } from "@posthog/ui/primitives/toast";
import { openTaskInput } from "@posthog/ui/router/useOpenTask";
import { track } from "@posthog/ui/shell/analytics";
import { logger } from "@posthog/ui/shell/logger";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { BoundAction } from "./useBoundActions";

const log = logger.scope("home-quick-action");

export interface RunWorkstreamAction {
  run: (action: BoundAction, workstream: HomeWorkstream) => void;
}

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
 * Stays on Home — the new task is spliced into the workstream's task list
 * optimistically and `isPending` disables the trigger while it starts. Falls
 * back to the new-task screen (prompt prefilled) when it can't start cleanly —
 * offline, signed out, or the repo has no GitHub integration.
 */
export function useRunWorkstreamAction(): RunWorkstreamAction {
  // Shared, workstream-keyed in-flight state so the row and the open detail panel
  // (independent hook instances) can't both start a task for the same workstream.
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
  const queryClient = useQueryClient();
  // Fire-and-forget nudge so the server worker rebuilds the snapshot sooner; the
  // optimistic splice covers the gap until the next poll reconciles.
  const refreshHome = useAuthenticatedMutation((client) =>
    client.refreshHomeSnapshot(),
  );

  const run = useCallback(
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

      const quickActions = useQuickActionStore.getState();
      if (quickActions.inFlight[workstream.id]) return;
      quickActions.start(workstream.id);

      void (async () => {
        try {
          // The cloud runtime requires a model: action-pinned, then last-used,
          // then the adapter's server default. The preferred candidate is only
          // honoured if the gateway still offers it (the resolver validates it),
          // so a stale persisted/pinned id can't reach the run and 403.
          const adapter = action.adapter ?? lastUsedAdapter;
          const preferredModel = action.model ?? lastUsedModel ?? undefined;
          let model = preferredModel;
          if (cloudRegion) {
            // The resolver swallows transient failures and returns undefined; fall
            // back to the preferred id so a gateway outage degrades like the old
            // code (a stale id may still 403) instead of hard-blocking valid runs.
            const resolvedModel = await modelResolver.resolveDefaultModel(
              getCloudUrlFromRegion(cloudRegion),
              adapter,
              preferredModel,
            );
            model = resolvedModel ?? preferredModel;
          }
          if (!model) {
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
            homeQuickActionLabel: action.label,
          };

          const result = await taskService.createTask(input, (output) => {
            // Stay on Home: refresh the task caches and splice the new run into
            // this workstream's list so it shows up immediately (tagged with the
            // quick action), then let the server worker reconcile on the next poll.
            invalidateTasks(output.task);
            queryClient.setQueryData<HomeSnapshot>(homeKeys.snapshot, (old) =>
              old
                ? insertOptimisticTask(
                    old,
                    workstream.id,
                    output.task,
                    action.label,
                  )
                : old,
            );
            void refreshHome.mutateAsync().catch(() => {});
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
          toast.error("Failed to start task", { description: result.error });
          log.error("Quick action task creation failed", {
            failedStep: result.failedStep,
            error: result.error,
          });
          fallbackToTaskInput();
        } catch (error) {
          const description =
            error instanceof Error ? error.message : "Unknown error";
          toast.error("Failed to start task", { description });
          log.error("Quick action task creation threw", { error });
          fallbackToTaskInput();
        } finally {
          useQuickActionStore.getState().finish(workstream.id);
        }
      })();
    },
    [
      isAuthenticated,
      isOnline,
      cloudRegion,
      invalidateTasks,
      queryClient,
      refreshHome.mutateAsync,
      getUserIntegrationIdForRepo,
      lastUsedAdapter,
      lastUsedModel,
      taskService,
      modelResolver,
    ],
  );

  return { run };
}
