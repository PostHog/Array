import { GitBranch, Spinner } from "@phosphor-icons/react";
import { TASK_FORK_SERVICE } from "@posthog/core/task-detail/identifiers";
import { getErrorTitle } from "@posthog/core/task-detail/taskInput";
import type { TaskForkService } from "@posthog/core/task-detail/taskForkService";
import { useService } from "@posthog/di/react";
import { Button } from "@posthog/quill";
import { isTerminalStatus, type Task } from "@posthog/shared/domain-types";
import { useSessionSelector } from "@posthog/ui/features/sessions/useSession";
import { toastError } from "@posthog/ui/features/notifications/errorDetails";
import { useProvisioningStore } from "@posthog/ui/features/provisioning/store";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { useWorkspace } from "@posthog/ui/features/workspace/useWorkspace";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import { toast } from "@posthog/ui/primitives/toast";
import { navigateToTaskDetail } from "@posthog/ui/router/navigationBridge";
import { openTask } from "@posthog/ui/router/useOpenTask";
import { useState } from "react";
import { shallow } from "zustand/shallow";

export function ForkTaskButton({ task }: { task: Task }) {
  const taskForkService = useService<TaskForkService>(TASK_FORK_SERVICE);
  const { invalidateTasks } = useCreateTask();
  const workspace = useWorkspace(task.id);
  const { cloudStatus, isPromptPending, sessionStatus, sessionTaskRunId } =
    useSessionSelector(
      task.id,
      (session) => ({
        cloudStatus: session?.cloudStatus,
        isPromptPending: session?.isPromptPending ?? false,
        sessionStatus: session?.status,
        sessionTaskRunId: session?.taskRunId,
      }),
      shallow,
    );
  const [isForking, setIsForking] = useState(false);
  const run = task.latest_run;
  const isCloud = workspace?.mode === "cloud" || run?.environment === "cloud";
  const currentCloudStatus =
    run && sessionTaskRunId === run.id
      ? (cloudStatus ?? run.status)
      : run?.status;

  let disabledReason: string | null = null;
  if (task.runtime === "pi") {
    disabledReason = "Pi tasks cannot be forked yet";
  } else if (!run) {
    disabledReason = "This task has no run to fork";
  } else if (isCloud && !isTerminalStatus(currentCloudStatus)) {
    disabledReason = "Wait for the cloud run to finish before forking it";
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
    setIsForking(true);
    try {
      const result = await taskForkService.forkTask(task, {
        sourceRunStatus: currentCloudStatus,
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

      invalidateTasks(result.data.task);
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
