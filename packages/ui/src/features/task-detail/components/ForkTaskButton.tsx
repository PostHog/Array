import { GitBranch, Spinner } from "@phosphor-icons/react";
import { TASK_FORK_SERVICE } from "@posthog/core/task-detail/identifiers";
import type { TaskForkService } from "@posthog/core/task-detail/taskForkService";
import { useService } from "@posthog/di/react";
import { Button } from "@posthog/quill";
import { isTerminalStatus, type Task } from "@posthog/shared/domain-types";
import { useSessionForTask } from "@posthog/ui/features/sessions/useSession";
import { useWorkspace } from "@posthog/ui/features/workspace/useWorkspace";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import { toast } from "@posthog/ui/primitives/toast";
import { navigateToTaskDetail } from "@posthog/ui/router/navigationBridge";
import { useState } from "react";

export function ForkTaskButton({ task }: { task: Task }) {
  const taskForkService = useService<TaskForkService>(TASK_FORK_SERVICE);
  const workspace = useWorkspace(task.id);
  const session = useSessionForTask(task.id);
  const [isForking, setIsForking] = useState(false);
  const run = task.latest_run;
  const isCloud = workspace?.mode === "cloud" || run?.environment === "cloud";
  const canForkCloud = !!run && isTerminalStatus(run.status);
  const canForkLocal =
    !!run &&
    !!workspace &&
    !workspace.isScratch &&
    session?.status === "connected" &&
    !session.isPromptPending;
  const canFork = isCloud ? canForkCloud : canForkLocal;
  const tooltip = canFork
    ? "Fork task"
    : isCloud
      ? "Wait for the cloud run to finish"
      : "Wait for the local task to finish";

  const handleFork = async () => {
    setIsForking(true);
    try {
      const result = await taskForkService.forkTask(task, ({ task: child }) => {
        navigateToTaskDetail(child.id);
      });
      if (!result.success) {
        toast.error("Could not fork task", { description: result.error });
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
