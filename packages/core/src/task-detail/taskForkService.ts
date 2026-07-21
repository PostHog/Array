import type { AgentSession, TaskCreationOutput } from "@posthog/shared";
import {
  executionModeSchema,
  isTerminalStatus,
  type Task,
  type TaskRunStatus,
} from "@posthog/shared/domain-types";
import { inject, injectable } from "inversify";
import {
  getCloudPrAuthorshipMode,
  getCloudRunSource,
} from "../sessions/cloudRunOptions";
import {
  SESSION_SERVICE,
  type SessionService,
} from "../sessions/sessionService";
import { TASK_CREATION_HOST, TASK_SERVICE } from "./identifiers";
import type { ITaskCreationHost } from "./taskCreationHost";
import type { CreateTaskResult, TaskService } from "./taskService";

export interface ForkTaskOptions {
  onTaskReady?: (output: TaskCreationOutput) => void;
}

type CloudForkSession = Pick<
  AgentSession,
  | "agentIdleForRunId"
  | "cloudStatus"
  | "isCloud"
  | "isPromptPending"
  | "taskRunId"
>;

export function canForkCloudRun(
  taskRunId: string,
  persistedStatus: TaskRunStatus | null | undefined,
  session: CloudForkSession | null | undefined,
): boolean {
  const matchingSession =
    session?.isCloud === true && session.taskRunId === taskRunId
      ? session
      : undefined;

  return (
    isTerminalStatus(persistedStatus) ||
    isTerminalStatus(matchingSession?.cloudStatus) ||
    (matchingSession?.agentIdleForRunId === taskRunId &&
      !matchingSession.isPromptPending)
  );
}

export function getForkSourceTaskId(task: Task): string | null {
  const sourceTaskId = task.latest_run?.state?.forked_from_task_id;
  return typeof sourceTaskId === "string" ? sourceTaskId : null;
}

@injectable()
export class TaskForkService {
  constructor(
    @inject(TASK_CREATION_HOST)
    private readonly host: ITaskCreationHost,
    @inject(TASK_SERVICE)
    private readonly taskService: TaskService,
    @inject(SESSION_SERVICE)
    private readonly sessionService: SessionService,
  ) {}

  async forkTask(
    sourceTask: Task,
    options: ForkTaskOptions = {},
  ): Promise<CreateTaskResult> {
    if (sourceTask.runtime === "pi") {
      return this.validationError("Pi tasks cannot be forked yet");
    }

    const sourceWorkspace = await this.host.getWorkspace(sourceTask.id);
    const sourceSession = this.sessionService.getSessionByTaskId(sourceTask.id);
    const isCloud =
      sourceSession?.isCloud !== undefined
        ? sourceSession.isCloud
        : sourceWorkspace
          ? sourceWorkspace.mode === "cloud"
          : sourceTask.latest_run?.environment === "cloud";

    if (!isCloud) {
      if (
        !sourceWorkspace ||
        sourceWorkspace.mode === "cloud" ||
        sourceWorkspace.isScratch
      ) {
        return this.validationError(
          "Only repository-backed local tasks can be forked",
        );
      }
      const additionalDirectories = await this.host.getAdditionalDirectories(
        sourceTask.id,
      );

      return this.taskService.createTask(
        {
          content: sourceTask.description || sourceTask.title,
          taskDescription: sourceTask.description || sourceTask.title,
          repoPath: sourceWorkspace.folderPath,
          repository: sourceTask.repository,
          workspaceMode: "worktree",
          branch: null,
          additionalDirectories,
          forkFrom: {
            kind: "local",
            taskId: sourceTask.id,
          },
        },
        options.onTaskReady,
      );
    }

    const sourceTaskRunId = sourceSession?.isCloud
      ? sourceSession.taskRunId
      : sourceTask.latest_run?.id;
    if (!sourceTaskRunId) {
      return this.validationError("This task has no cloud run to fork");
    }

    let sourceRun = sourceTask.latest_run;
    if (!sourceRun || sourceRun.id !== sourceTaskRunId) {
      const client = await this.host.getAuthenticatedClient();
      if (!client) {
        return this.validationError("Not authenticated");
      }
      try {
        sourceRun = await client.getTaskRun(sourceTask.id, sourceTaskRunId);
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch the source task run",
          failedStep: "fetch_task",
        };
      }
    }
    if (sourceRun.environment !== "cloud") {
      return this.validationError("The source run is not a cloud run");
    }
    if (!canForkCloudRun(sourceRun.id, sourceRun.status, sourceSession)) {
      return this.validationError(
        "Wait for the current cloud turn to finish before forking it",
      );
    }

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
        repoPath: undefined,
        repository: sourceTask.repository,
        workspaceMode: "cloud",
        branch: cloudBranch,
        githubIntegrationId: sourceTask.github_integration ?? undefined,
        githubUserIntegrationId:
          sourceTask.github_user_integration ?? undefined,
        executionMode: executionModeSchema.safeParse(
          state.initial_permission_mode,
        ).data,
        adapter: sourceRun.runtime_adapter ?? undefined,
        model: sourceRun.model ?? undefined,
        reasoningLevel: sourceRun.reasoning_effort ?? undefined,
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
          kind: "cloud",
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
