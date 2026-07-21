import type { TaskCreationOutput } from "@posthog/shared";
import {
  executionModeSchema,
  isTerminalStatus,
  type Task,
  type TaskRun,
} from "@posthog/shared/domain-types";
import { inject, injectable } from "inversify";
import {
  getCloudPrAuthorshipMode,
  getCloudRunSource,
} from "../sessions/cloudRunOptions";
import { TASK_CREATION_HOST, TASK_SERVICE } from "./identifiers";
import type { ITaskCreationHost } from "./taskCreationHost";
import type { CreateTaskResult, TaskService } from "./taskService";

export interface ForkTaskOptions {
  sourceRunStatus?: TaskRun["status"];
  onTaskReady?: (output: TaskCreationOutput) => void;
}

@injectable()
export class TaskForkService {
  constructor(
    @inject(TASK_CREATION_HOST)
    private readonly host: ITaskCreationHost,
    @inject(TASK_SERVICE)
    private readonly taskService: TaskService,
  ) {}

  async forkTask(
    sourceTask: Task,
    options: ForkTaskOptions = {},
  ): Promise<CreateTaskResult> {
    const sourceRun = sourceTask.latest_run;
    if (!sourceRun) {
      return this.validationError("The source task has no run to fork");
    }
    if (sourceTask.runtime === "pi") {
      return this.validationError("Pi tasks cannot be forked yet");
    }

    const sourceWorkspace = await this.host.getWorkspace(sourceTask.id);
    const isCloud =
      sourceWorkspace?.mode === "cloud" || sourceRun.environment === "cloud";
    if (
      isCloud &&
      !isTerminalStatus(options.sourceRunStatus ?? sourceRun.status)
    ) {
      return this.validationError(
        "Wait for the cloud run to finish before forking it",
      );
    }
    if (!isCloud && (!sourceWorkspace || sourceWorkspace.isScratch)) {
      return this.validationError(
        "Only repository-backed local tasks can be forked",
      );
    }
    const additionalDirectories = isCloud
      ? undefined
      : await this.host.getAdditionalDirectories(sourceTask.id);

    const output = sourceRun.output ?? {};
    const state = sourceRun.state ?? {};
    const cloudBranch =
      (typeof output.head_branch === "string" ? output.head_branch : null) ??
      sourceRun.branch ??
      (typeof state.pr_base_branch === "string" ? state.pr_base_branch : null);

    return this.taskService.createTask(
      {
        content: sourceTask.description || sourceTask.title,
        taskDescription: sourceTask.description || sourceTask.title,
        repoPath: isCloud ? undefined : sourceWorkspace?.folderPath,
        repository: sourceTask.repository,
        workspaceMode: isCloud ? "cloud" : "worktree",
        branch: isCloud ? cloudBranch : null,
        githubIntegrationId: sourceTask.github_integration ?? undefined,
        githubUserIntegrationId:
          sourceTask.github_user_integration ?? undefined,
        executionMode: executionModeSchema.safeParse(
          state.initial_permission_mode,
        ).data,
        adapter: sourceRun.runtime_adapter ?? undefined,
        model: sourceRun.model ?? undefined,
        reasoningLevel: sourceRun.reasoning_effort ?? undefined,
        additionalDirectories,
        sandboxEnvironmentId:
          typeof state.sandbox_environment_id === "string"
            ? state.sandbox_environment_id
            : undefined,
        customImageId:
          typeof state.custom_image_id === "string"
            ? state.custom_image_id
            : undefined,
        cloudAutoPublish: state.auto_publish === true,
        cloudRtkEnabled: state.rtk_enabled === false ? false : undefined,
        cloudRunSource: getCloudRunSource(state),
        cloudPrAuthorshipMode: getCloudPrAuthorshipMode(state),
        forkFrom: {
          taskId: sourceTask.id,
          taskRunId: sourceRun.id,
        },
      },
      options.onTaskReady,
    );
  }

  private validationError(error: string): CreateTaskResult {
    return { success: false, error, failedStep: "validation" };
  }
}
