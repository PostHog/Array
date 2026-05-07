import { buildPromptBlocks } from "@features/editor/utils/prompt-builder";
import { DEFAULT_PANEL_IDS } from "@features/panels/constants/panelConstants";
import { usePanelLayoutStore } from "@features/panels/store/panelLayoutStore";
import { useProvisioningStore } from "@features/provisioning/stores/provisioningStore";
import {
  type ConnectParams,
  getSessionService,
} from "@features/sessions/service/service";
import {
  getCloudPromptTransport,
  uploadRunAttachments,
} from "@features/sessions/utils/cloudArtifacts";
import { getTaskDirectory } from "@hooks/useRepositoryDirectory";
import type {
  Workspace,
  WorkspaceMode,
} from "@main/services/workspace/schemas";
import { Saga, type SagaLogger } from "@posthog/shared";
import type { PostHogAPIClient } from "@renderer/api/posthogClient";
import { trpcClient } from "@renderer/trpc";
import { createFileTagRegex } from "@renderer/utils/generateTitle";
import { getTaskRepository } from "@renderer/utils/repository";
import {
  type ExecutionMode,
  SIGNAL_REPORT_TASK_IMPLEMENTATION_RELATIONSHIP,
  type Task,
} from "@shared/types";
import type { CloudRunSource, PrAuthorshipMode } from "@shared/types/cloud";
import { logger } from "@utils/logger";

const log = logger.scope("task-creation-saga");

// Adapt our logger to SagaLogger interface
const sagaLogger: SagaLogger = {
  info: (message, data) => log.info(message, data),
  debug: (message, data) => log.debug(message, data),
  error: (message, data) => log.error(message, data),
  warn: (message, data) => log.warn(message, data),
};

export interface TaskCreationInput {
  // For opening existing task
  taskId?: string;
  // For creating new task (required if no taskId)
  content?: string;
  taskDescription?: string;
  filePaths?: string[];
  repoPath?: string;
  repository?: string | null;
  workspaceMode?: WorkspaceMode;
  branch?: string | null;
  githubIntegrationId?: number;
  githubUserIntegrationId?: string;
  executionMode?: ExecutionMode;
  adapter?: "claude" | "codex";
  model?: string;
  reasoningLevel?: string;
  environmentId?: string;
  sandboxEnvironmentId?: string;
  cloudPrAuthorshipMode?: PrAuthorshipMode;
  cloudRunSource?: CloudRunSource;
  signalReportId?: string;
}

export interface TaskCreationOutput {
  task: Task;
  workspace: Workspace | null;
}

export interface TaskCreationDeps {
  posthogClient: PostHogAPIClient;
  onTaskReady?: (output: TaskCreationOutput) => void;
}

export class TaskCreationSaga extends Saga<
  TaskCreationInput,
  TaskCreationOutput
> {
  readonly sagaName = "TaskCreationSaga";

  constructor(private deps: TaskCreationDeps) {
    super(sagaLogger);
  }

  protected async execute(
    input: TaskCreationInput,
  ): Promise<TaskCreationOutput> {
    // Step 1: Get or create task
    // For new tasks, start folder registration in parallel with task creation
    // since folder_registration only needs repoPath (from input), not task.id
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
        getTaskDirectory(task.id, repoKey ?? undefined),
      ));

    // Step 3: Resolve workspaceMode - input takes precedence, then derive from task
    const workspaceMode =
      input.workspaceMode ??
      (task.latest_run?.environment === "cloud" ? "cloud" : "local");

    // Step 4: Create workspace if we have a directory
    let workspace: Workspace | null = null;
    const branch = input.branch ?? task.latest_run?.branch ?? null;
    const hasProvisioning =
      workspaceMode === "worktree" && !!repoPath && !input.taskId;

    if (hasProvisioning) {
      useProvisioningStore.getState().setActive(task.id);
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
          return trpcClient.workspace.create.mutate({
            taskId: task.id,
            mainRepoPath: repoPath,
            folderId: folder.id,
            folderPath: repoPath,
            mode: workspaceMode,
            branch: branch ?? undefined,
          });
        },
        rollback: async () => {
          log.info("Rolling back: deleting workspace", { taskId: task.id });
          await trpcClient.workspace.delete.mutate({
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
          return trpcClient.workspace.create.mutate({
            taskId: task.id,
            mainRepoPath: "",
            folderId: "",
            folderPath: "",
            mode: "cloud",
            branch: branch ?? undefined,
          });
        },
        rollback: async () => {
          log.info("Rolling back: deleting cloud workspace", {
            taskId: task.id,
          });
          await trpcClient.workspace.delete.mutate({
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

    const shouldStartCloudRun = workspaceMode === "cloud" && !task.latest_run;

    if (!hasProvisioning && !shouldStartCloudRun && this.deps.onTaskReady) {
      this.deps.onTaskReady({ task, workspace });
    }

    if (hasProvisioning) {
      useProvisioningStore.getState().clear(task.id);
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

    // Step 5: Start cloud run (only for new cloud tasks)
    if (shouldStartCloudRun) {
      task = await this.step({
        name: "cloud_run",
        execute: async () => {
          const hasUserGitHubIntegration =
            !!input.githubUserIntegrationId || !!task.github_user_integration;
          const prAuthorshipMode =
            input.cloudPrAuthorshipMode ??
            (hasUserGitHubIntegration ? "user" : "bot");

          const transport =
            (input.content || input.filePaths?.length) &&
            workspaceMode === "cloud"
              ? getCloudPromptTransport(input.content ?? "", input.filePaths)
              : null;
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
            ? await uploadRunAttachments(
                this.deps.posthogClient,
                task.id,
                taskRun.id,
                transport.filePaths,
              )
            : [];

          return this.deps.posthogClient.startTaskRun(task.id, taskRun.id, {
            pendingUserMessage: transport?.messageText,
            pendingUserArtifactIds:
              pendingUserArtifactIds.length > 0
                ? pendingUserArtifactIds
                : undefined,
          });
        },
        rollback: async () => {
          log.info("Rolling back: cloud run (no-op)", { taskId: task.id });
        },
      });

      if (!hasProvisioning && this.deps.onTaskReady) {
        this.deps.onTaskReady({ task, workspace });
      }
    }

    // Step 7: Connect to session
    // Cloud create: skip local session — the sandbox handles execution
    const agentCwd =
      workspace?.worktreePath ?? workspace?.folderPath ?? repoPath;
    const isCloudCreate = !input.taskId && workspaceMode === "cloud";
    const shouldConnect =
      !isCloudCreate &&
      (!!input.taskId || // Open: always connect to load chat history
        !!agentCwd); // Local create: always connect if we have a cwd

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

      await this.step({
        name: "agent_session",
        execute: async () => {
          // Fire-and-forget for both open and create paths.
          // The UI handles "connecting" state with a spinner (TaskLogsPanel),
          // so we don't need to block the saga on the full reconnect chain.
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

          getSessionService().connectToTask(connectParams);
          return { taskId: task.id };
        },
        rollback: async ({ taskId }) => {
          log.info("Rolling back: disconnecting agent session", { taskId });
          await getSessionService().disconnectFromTask(taskId);
        },
      });
    }

    return { task, workspace };
  }

  private async resolveFolder(repoPath: string) {
    const folders = await trpcClient.folders.getFolders.query();
    let existingFolder = folders.find((f) => f.path === repoPath);

    if (!existingFolder) {
      existingFolder = await trpcClient.folders.addFolder.mutate({
        folderPath: repoPath,
      });
    }
    return existingFolder;
  }

  private dispatchEnvironmentSetup(
    taskId: string,
    environmentId: string,
    repoPath: string,
    worktreePath: string,
  ): void {
    trpcClient.environment.get
      .query({ repoPath, id: environmentId })
      .then((env) => {
        if (!env?.setup?.script) return;

        const actionId = `setup-${environmentId}-${Date.now()}`;
        usePanelLayoutStore
          .getState()
          .addActionTab(taskId, DEFAULT_PANEL_IDS.MAIN_PANEL, {
            actionId,
            command: env.setup.script,
            cwd: worktreePath,
            label: `Setup: ${env.name}`,
          });
      })
      .catch((error) => {
        log.error("Failed to dispatch environment setup script", {
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
        trpcClient.git.detectRepo.query({
          directoryPath: repoPathForDetection,
        }),
      );
      if (detected) {
        repository = `${detected.organization}/${detected.repository}`;
      }
    }

    return this.step({
      name: "task_creation",
      execute: async () => {
        const description = input.taskDescription ?? input.content ?? "";
        const plainText = description.replace(createFileTagRegex(), "").trim();
        const result = await this.deps.posthogClient.createTask({
          title: (plainText || "Reading attachment\u2026").slice(0, 255),
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
        log.info("Rolling back: deleting task", { taskId: createdTask.id });
        await this.deps.posthogClient.deleteTask(createdTask.id);
      },
    });
  }
}
