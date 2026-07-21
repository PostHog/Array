import { GitBranch, Spinner } from "@phosphor-icons/react";
import { TASK_FORK_SERVICE } from "@posthog/core/task-detail/identifiers";
import { getErrorTitle } from "@posthog/core/task-detail/taskInput";
import type {
  ForkTaskOptions,
  TaskForkService,
} from "@posthog/core/task-detail/taskForkService";
import { canForkCloudRun } from "@posthog/core/task-detail/taskForkService";
import { useService } from "@posthog/di/react";
import { useHostTRPC } from "@posthog/host-router/react";
import { Button } from "@posthog/quill";
import type { Workspace } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import { useSessionSelector } from "@posthog/ui/features/sessions/useSession";
import { toastError } from "@posthog/ui/features/notifications/errorDetails";
import { useProvisioningStore } from "@posthog/ui/features/provisioning/store";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { useWorkspace } from "@posthog/ui/features/workspace/useWorkspace";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import { toast } from "@posthog/ui/primitives/toast";
import { navigateToTaskDetail } from "@posthog/ui/router/navigationBridge";
import { openTask } from "@posthog/ui/router/useOpenTask";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { shallow } from "zustand/shallow";

export function ForkTaskButton({ task }: { task: Task }) {
  const taskForkService = useService<TaskForkService>(TASK_FORK_SERVICE);
  const trpc = useHostTRPC();
  const queryClient = useQueryClient();
  const { seedTask } = useCreateTask();
  const workspace = useWorkspace(task.id);
  const {
    agentIdleForRunId,
    cloudStatus,
    isPromptPending,
    sessionIsCloud,
    sessionStatus,
    sessionTaskRunId,
  } = useSessionSelector(
    task.id,
    (session) => ({
      cloudStatus: session?.cloudStatus,
      agentIdleForRunId: session?.agentIdleForRunId,
      isPromptPending: session?.isPromptPending ?? false,
      sessionIsCloud: session?.isCloud,
      sessionStatus: session?.status,
      sessionTaskRunId: session?.taskRunId,
    }),
    shallow,
  );
  const [isForking, setIsForking] = useState(false);
  const run = task.latest_run;
  const hasLiveSession =
    sessionStatus === "connected" || sessionStatus === "connecting";
  const isCloud =
    hasLiveSession && sessionIsCloud !== undefined
      ? sessionIsCloud
      : workspace
        ? workspace.mode === "cloud"
        : run?.environment === "cloud";
  const cloudTaskRunId = isCloud
    ? hasLiveSession && sessionIsCloud
      ? sessionTaskRunId
      : run?.id
    : undefined;
  const currentCloudStatus =
    cloudTaskRunId === sessionTaskRunId
      ? (cloudStatus ?? (run?.id === cloudTaskRunId ? run?.status : undefined))
      : run?.status;
  const canForkCurrentCloudRun = cloudTaskRunId
    ? canForkCloudRun(cloudTaskRunId, currentCloudStatus, {
        agentIdleForRunId,
        cloudStatus,
        isCloud: sessionIsCloud,
        isPromptPending,
        taskRunId: sessionTaskRunId ?? "",
      })
    : false;

  let disabledReason: string | null = null;
  if (task.runtime === "pi") {
    disabledReason = "Pi tasks cannot be forked yet";
  } else if (isCloud && !cloudTaskRunId) {
    disabledReason = "This task has no run to fork";
  } else if (isCloud && !canForkCurrentCloudRun) {
    disabledReason =
      "Wait for the current cloud turn to finish before forking it";
  } else if (!isCloud && (!workspace || workspace.isScratch)) {
    disabledReason = "Only repository-backed local tasks can be forked";
  } else if (!isCloud && sessionStatus !== "connected") {
    disabledReason =
      sessionStatus === "disconnected" || sessionStatus === "error"
        ? "Reconnect the local task before forking it"
        : "Wait for the local task to connect before forking it";
  } else if (!isCloud && isPromptPending) {
    disabledReason = "Wait for the local task to finish before forking it";
  }

  const canFork = disabledReason === null;
  const tooltip = disabledReason ?? "Fork task";

  const handleFork = async () => {
    let source: ForkTaskOptions["source"];
    if (isCloud) {
      if (!cloudTaskRunId || !canForkCurrentCloudRun) return;
      source = {
        kind: "cloud",
        taskRunId: cloudTaskRunId,
      };
    } else {
      source = { kind: "local" };
    }

    setIsForking(true);
    try {
      const result = await taskForkService.forkTask(task, {
        source,
      });
      if (!result.success) {
        toast.error("Could not fork task", { description: result.error });
        return;
      }

      if (result.data.provisioningError) {
        useProvisioningStore
          .getState()
          .setFailed(result.data.task.id, result.data.provisioningError);
      }

      if (result.data.workspace) {
        queryClient.setQueryData<Record<string, Workspace>>(
          trpc.workspace.getAll.queryKey(),
          (workspaces) => ({
            ...workspaces,
            [result.data.task.id]: result.data.workspace as Workspace,
          }),
        );
      }
      seedTask(result.data.task);
      void openTask(result.data.task);
      if (result.data.provisioningError) {
        toastError(
          getErrorTitle("workspace_creation"),
          result.data.provisioningError,
        );
      }
    } catch (error) {
      toast.error("Could not fork task", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsForking(false);
    }
  };

  return (
    <Tooltip content={tooltip} side="bottom">
      <span className="no-drag inline-flex">
        <Button
          variant="outline"
          size="icon"
          aria-label="Fork task"
          disabled={!canFork || isForking}
          onClick={handleFork}
        >
          {isForking ? (
            <Spinner size={14} className="animate-spin" />
          ) : (
            <GitBranch size={14} />
          )}
        </Button>
      </span>
    </Tooltip>
  );
}

export function ForkedFromTaskButton({ task }: { task: Task }) {
  const parentTaskId = task.latest_run?.state?.forked_from_task_id;
  if (typeof parentTaskId !== "string") return null;

  return (
    <Tooltip content="Open source task" side="bottom">
      <span className="no-drag inline-flex">
        <Button
          variant="outline"
          size="icon"
          aria-label="Open source task"
          onClick={() => navigateToTaskDetail(parentTaskId)}
        >
          <GitBranch size={14} weight="fill" />
        </Button>
      </span>
    </Tooltip>
  );
}
