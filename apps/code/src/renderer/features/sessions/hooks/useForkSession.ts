import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import {
  fetchAuthState,
  useAuthStateValue,
} from "@features/auth/hooks/authQueries";
import { useSessionForTask } from "@features/sessions/hooks/useSession";
import { useWorkspace } from "@features/workspace/hooks/useWorkspace";
import { useTRPC } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { useNavigationStore } from "@stores/navigationStore";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@utils/toast";
import { useCallback } from "react";

interface UseForkSessionOptions {
  taskId: string | undefined;
  task: Task | undefined;
}

export function useForkSession({ taskId, task }: UseForkSessionOptions) {
  const workspace = useWorkspace(taskId);
  const session = useSessionForTask(taskId);
  const posthogClient = useOptionalAuthenticatedClient();
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);
  const projectId = useAuthStateValue((s) => s.projectId);
  const navigateToTask = useNavigationStore((s) => s.navigateToTask);
  const trpc = useTRPC();

  const prepareForkMutation = useMutation(
    trpc.fork.prepareFork.mutationOptions(),
  );

  const fork = useCallback(
    async (messageIndex: number) => {
      if (
        !taskId ||
        !task ||
        !workspace ||
        !session ||
        !cloudRegion ||
        !projectId ||
        !posthogClient
      ) {
        toast.error("Cannot fork: missing task, workspace, or session data");
        return;
      }

      const sourceWorktreePath = workspace.worktreePath ?? workspace.folderPath;
      const mainRepoPath = workspace.folderPath;

      if (!sourceWorktreePath || !mainRepoPath) {
        toast.error("Cannot fork: workspace has no repository path");
        return;
      }

      const model = session.configOptions?.find((o) => o.id === "model")
        ?.currentValue as string | undefined;

      const toastId = toast.loading("Creating fork…");

      try {
        // 1. Create a new task on PostHog
        const newTask = await posthogClient.createTask({
          title: `Fork of: ${task.title}`,
          description: task.description ?? "",
          repository: task.repository ?? undefined,
          origin_product: "user_created",
        });

        // 2. Create a task run for it
        const newTaskRun = await posthogClient.createTaskRun(newTask.id);

        // 3. Prepare the fork in the main process (worktree + JSONL)
        const authState = await fetchAuthState();
        if (authState.status !== "authenticated" || !authState.cloudRegion) {
          throw new Error("Not authenticated");
        }
        const apiHost = getCloudUrlFromRegion(authState.cloudRegion);

        await prepareForkMutation.mutateAsync({
          sourceTaskId: taskId,
          sourceTaskRunId: session.taskRunId,
          sourceTaskTitle: task.title,
          forkAtMessageIndex: messageIndex,
          newTaskId: newTask.id,
          newTaskRunId: newTaskRun.id,
          sourceWorktreePath,
          mainRepoPath,
          apiHost,
          projectId,
          model,
        });

        toast.success("Fork created", { id: toastId });

        // 4. Navigate to the new task
        navigateToTask(newTask as unknown as Task);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create fork",
          {
            id: toastId,
          },
        );
      }
    },
    [
      taskId,
      task,
      workspace,
      session,
      cloudRegion,
      projectId,
      posthogClient,
      prepareForkMutation,
      navigateToTask,
    ],
  );

  return {
    fork,
    isForkPending: prepareForkMutation.isPending,
  };
}
