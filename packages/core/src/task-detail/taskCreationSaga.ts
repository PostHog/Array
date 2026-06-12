import {
  buildChannelContextBlock,
  buildChannelContextText,
  buildPromptBlocks,
} from "@posthog/core/editor/prompt-builder";
import type {
  ConnectParams,
  SessionService,
} from "@posthog/core/sessions/sessionService";
import {
  getTaskRepository,
  Saga,
  type SagaLogger,
  type TaskCreationInput,
  type TaskCreationOutput,
  type Workspace,
} from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import {
  SIGNAL_REPORT_TASK_IMPLEMENTATION_RELATIONSHIP,
  type Task,
} from "@posthog/shared/domain-types";
import type { TaskCreationApiClient } from "./taskCreationApiClient";
import type { ITaskCreationHost } from "./taskCreationHost";

export interface TaskCreationDeps {
  posthogClient: TaskCreationApiClient;
  host: ITaskCreationHost;
  sessionService: SessionService;
  onTaskReady?: (output: TaskCreationOutput) => void;
  track: (event: string, props?: Record<string, unknown>) => void;
}

export class TaskCreationSaga extends Saga<
  TaskCreationInput,
  TaskCreationOutput
> {
  readonly sagaName = "TaskCreationSaga";

  constructor(
    private deps: TaskCreationDeps,
    logger?: SagaLogger,
  ) {
    super(logger);
  }

  protected async execute(
    input: TaskCreationInput,
  ): Promise<TaskCreationOutput> {
    const taskId = input.taskId;
    const folderPromise =
      !taskId && input.repoPath
        ? this.resolveFolder(input.repoPath)
        : undefined;

    let task = taskId
      ? await this.readOnlyStep("fetch_task", () =>
          this.deps.posthogClient.getTask(taskId),
        )
      : await this.createTask(input);

    const repoKey = getTaskRepository(task);
    const repoPath =
      input.repoPath ??
      (await this.readOnlyStep("resolve_repo_path", () =>
        this.deps.host.getTaskDirectory(task.id, repoKey ?? undefined),
      ));

    const workspaceMode =
      input.workspaceMode ??
      (task.latest_run?.environment === "cloud" ? "cloud" : "local");

    let workspace: Workspace | null = null;
    const branch = input.branch ?? task.latest_run?.branch ?? null;
    const hasProvisioning =
      workspaceMode === "worktree" && !!repoPath && !input.taskId;

    if (hasProvisioning) {
      this.deps.host.setProvisioningActive(task.id);
      if (this.deps.onTaskReady) {
        this.deps.onTaskReady({ task, workspace });
      }
    }

    if (repoPath) {
      const folder = folderPromise
        ? await this.readOnlyStep("folder_registration", () => folderPromise)
        : await this.readOnlyStep("folder_registration", () =>
            this.resolveFolder(repoPath),
          );

      const workspaceInfo = await this.step({
        name: "workspace_creation",
        execute: async () => {
          return this.deps.host.createWorkspace({
            taskId: task.id,
            mainRepoPath: repoPath,
            folderId: folder.id,
            folderPath: repoPath,
            mode: workspaceMode,
            branch: branch ?? undefined,
          });
        },
        rollback: async () => {
          this.log.info("Rolling back: deleting workspace", {
            taskId: task.id,
          });
          await this.deps.host.deleteWorkspace({
            taskId: task.id,
            mainRepoPath: repoPath,
          });
        },
      });

      workspace = {
        taskId: task.id,
        folderId: folder.id,
        folderPath: repoPath,
        mode: workspaceMode,
        worktreePath: workspaceInfo.worktree?.worktreePath ?? null,
        worktreeName: workspaceInfo.worktree?.worktreeName ?? null,
        branchName: workspaceInfo.worktree?.branchName ?? null,
        baseBranch: workspaceInfo.worktree?.baseBranch ?? null,
        linkedBranch: workspaceInfo.linkedBranch ?? null,
        createdAt:
          workspaceInfo.worktree?.createdAt ?? new Date().toISOString(),
      };
    } else if (workspaceMode === "cloud") {
      await this.step({
        name: "cloud_workspace_creation",
        execute: async () => {
          return this.deps.host.createWorkspace({
            taskId: task.id,
            mainRepoPath: "",
            folderId: "",
            folderPath: "",
            mode: "cloud",
            branch: branch ?? undefined,
          });
        },
        rollback: async () => {
          this.log.info("Rolling back: deleting cloud workspace", {
            taskId: task.id,
          });
          await this.deps.host.deleteWorkspace({
            taskId: task.id,
            mainRepoPath: "",
          });
        },
      });

      workspace = {
        taskId: task.id,
        folderId: "",
        folderPath: "",
        mode: "cloud",
        worktreePath: null,
        worktreeName: null,
        branchName: null,
        baseBranch: branch,
        linkedBranch: null,
        createdAt: new Date().toISOString(),
      };
    }

    const extraDirectories = input.taskId
      ? []
      : (input.additionalDirectories ?? []).filter(
          (path) => path && path !== repoPath,
        );
    if (extraDirectories.length > 0) {
      await this.step({
        name: "additional_directories",
        execute: async () => {
          await Promise.all(
            extraDirectories.map((path) =>
              this.deps.host.addAdditionalDirectory({
                taskId: task.id,
                path,
              }),
            ),
          );
          return { taskId: task.id, paths: extraDirectories };
        },
        rollback: async ({ taskId, paths }) => {
          this.log.info("Rolling back: removing additional directories", {
            taskId,
          });
          await Promise.all(
            paths.map((path) =>
              this.deps.host
                .removeAdditionalDirectory({ taskId, path })
                .catch((error) => {
                  this.log.warn("Failed to remove additional directory", {
                    error,
                  });
                }),
            ),
          );
        },
      });
    }

    const shouldStartCloudRun = workspaceMode === "cloud" && !task.latest_run;

    if (!hasProvisioning && !shouldStartCloudRun && this.deps.onTaskReady) {
      this.deps.onTaskReady({ task, workspace });
    }

    if (hasProvisioning) {
      this.deps.host.clearProvisioning(task.id);
    }

    if (
      input.environmentId &&
      workspace?.worktreePath &&
      repoPath &&
      !input.taskId
    ) {
      this.dispatchEnvironmentSetup(
        task.id,
        input.environmentId,
        repoPath,
        workspace.worktreePath,
      );
    }

    if (shouldStartCloudRun) {
      task = await this.step({
        name: "cloud_run",
        execute: async () => {
          const prAuthorshipMode = input.cloudPrAuthorshipMode ?? "user";

          const transport =
            (input.content || input.filePaths?.length) &&
            workspaceMode === "cloud"
              ? this.deps.host.getCloudPromptTransport(
                  input.content ?? "",
                  input.filePaths,
                )
              : null;

          // The local connect path appends channel CONTEXT.md to initialPrompt;
          // cloud sends its first message as text, so fold the same block into
          // pendingUserMessage here. The conversation UI parses it identically.
          const channelContextText = buildChannelContextText(
            input.channelContext,
            input.channelName,
          );
          const messageText = transport?.messageText;
          const pendingUserMessage = channelContextText
            ? messageText
              ? `${messageText}\n\n${channelContextText}`
              : channelContextText
            : messageText;
          const taskRun = await this.deps.posthogClient.createTaskRun(task.id, {
            environment: "cloud",
            mode: "interactive",
            branch,
            adapter: input.adapter,
            model: input.model,
            reasoningLevel: input.reasoningLevel,
            sandboxEnvironmentId: input.sandboxEnvironmentId,
            prAuthorshipMode,
            runSource: input.cloudRunSource ?? "manual",
            signalReportId: input.signalReportId,
            initialPermissionMode: input.adapter
              ? (input.executionMode ??
                (input.adapter === "codex" ? "auto" : "plan"))
              : input.executionMode,
          });
          if (!taskRun?.id) {
            throw new Error("Failed to create cloud run");
          }

          const pendingUserArtifactIds = transport
            ? await this.deps.host.uploadRunAttachments(
                this.deps.posthogClient,
                task.id,
                taskRun.id,
                transport.filePaths,
              )
            : [];

          const startedRun = await this.deps.posthogClient.startTaskRun(
            task.id,
            taskRun.id,
            {
              pendingUserMessage,
              pendingUserArtifactIds:
                pendingUserArtifactIds.length > 0
                  ? pendingUserArtifactIds
                  : undefined,
            },
          );

          if (transport) {
            this.deps.track(ANALYTICS_EVENTS.PROMPT_SENT, {
              task_id: task.id,
              is_initial: true,
              execution_type: "cloud",
              prompt_length_chars: transport.messageText?.length ?? 0,
            });
          }

          return startedRun;
        },
        rollback: async () => {
          this.log.info("Rolling back: cloud run (no-op)", {
            taskId: task.id,
          });
        },
      });

      if (!hasProvisioning && this.deps.onTaskReady) {
        this.deps.onTaskReady({ task, workspace });
      }
    }

    const agentCwd =
      workspace?.worktreePath ?? workspace?.folderPath ?? repoPath;
    const isCloudCreate = !input.taskId && workspaceMode === "cloud";
    const shouldConnect = !isCloudCreate && (!!input.taskId || !!agentCwd);

    if (shouldConnect) {
      const initialPrompt =
        !input.taskId && input.content
          ? await this.readOnlyStep("build_prompt_blocks", () =>
              buildPromptBlocks(
                input.content ?? "",
                input.filePaths ?? [],
                agentCwd ?? "",
              ),
            )
          : undefined;

      // Append the channel's CONTEXT.md as optional background, so tasks made
      // in a channel start with the shared context the agent would otherwise
      // have to rediscover. Kept after the user's prompt so the request leads.
      const channelContextBlock = buildChannelContextBlock(
        input.channelContext,
        input.channelName,
      );
      if (initialPrompt && channelContextBlock) {
        initialPrompt.push(channelContextBlock);
      }

      await this.step({
        name: "agent_session",
        execute: async () => {
          const connectParams: ConnectParams = {
            task,
            repoPath: agentCwd ?? "",
          };
          if (initialPrompt) connectParams.initialPrompt = initialPrompt;
          if (input.executionMode)
            connectParams.executionMode = input.executionMode;
          if (input.adapter) connectParams.adapter = input.adapter;
          if (input.model) connectParams.model = input.model;
          if (input.reasoningLevel)
            connectParams.reasoningLevel = input.reasoningLevel;

          this.deps.sessionService.connectToTask(connectParams);
          return { taskId: task.id };
        },
        rollback: async ({ taskId }) => {
          this.log.info("Rolling back: disconnecting agent session", {
            taskId,
          });
          await this.deps.sessionService.disconnectFromTask(taskId);
        },
      });
    }

    return { task, workspace };
  }

  private async resolveFolder(repoPath: string) {
    const folders = await this.deps.host.getFolders();
    let existingFolder = folders.find((f) => f.path === repoPath);

    if (!existingFolder) {
      existingFolder = await this.deps.host.addFolder({ folderPath: repoPath });
    }
    return existingFolder;
  }

  private dispatchEnvironmentSetup(
    taskId: string,
    environmentId: string,
    repoPath: string,
    worktreePath: string,
  ): void {
    this.deps.host
      .getEnvironment({ repoPath, id: environmentId })
      .then((env) => {
        if (!env?.setup?.script) return;

        this.deps.host.dispatchSetupAction({
          taskId,
          command: env.setup.script,
          cwd: worktreePath,
          label: `Setup: ${env.name}`,
        });
      })
      .catch((error) => {
        this.log.error("Failed to dispatch environment setup script", {
          taskId,
          environmentId,
          error,
        });
      });
  }

  private async createTask(input: TaskCreationInput): Promise<Task> {
    let repository = input.repository;

    const repoPathForDetection = input.repoPath;
    if (!repository && repoPathForDetection) {
      const detected = await this.readOnlyStep("repo_detection", () =>
        this.deps.host.detectRepo({ directoryPath: repoPathForDetection }),
      );
      if (detected) {
        repository = `${detected.organization}/${detected.repository}`;
      }
    }

    return this.step({
      name: "task_creation",
      execute: async () => {
        const description = input.taskDescription ?? input.content ?? "";
        const result = await this.deps.posthogClient.createTask({
          description,
          repository: repository ?? undefined,
          github_integration:
            input.workspaceMode === "cloud" &&
            input.cloudRunSource === "signal_report"
              ? input.githubIntegrationId
              : undefined,
          github_user_integration:
            input.workspaceMode === "cloud" &&
            input.cloudRunSource !== "signal_report"
              ? input.githubUserIntegrationId
              : undefined,
          origin_product: input.signalReportId
            ? "signal_report"
            : "user_created",
          signal_report: input.signalReportId ?? undefined,
          signal_report_task_relationship: input.signalReportId
            ? SIGNAL_REPORT_TASK_IMPLEMENTATION_RELATIONSHIP
            : undefined,
        });
        return result as unknown as Task;
      },
      rollback: async (createdTask) => {
        this.log.info("Rolling back: deleting task", {
          taskId: createdTask.id,
        });
        await this.deps.posthogClient.deleteTask(createdTask.id);
      },
    });
  }
}
