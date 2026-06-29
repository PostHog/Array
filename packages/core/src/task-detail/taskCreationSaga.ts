import {
  buildChannelContextBlock,
  buildChannelContextText,
  buildCustomInstructionsText,
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
import type { Task } from "@posthog/shared/domain-types";
import type { TaskCreationApiClient } from "./taskCreationApiClient";
import type {
  ImportedClaudeCliSession,
  ITaskCreationHost,
} from "./taskCreationHost";

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

    const importedClaude = await this.importClaudeSession(input);

    let task = taskId
      ? await this.readOnlyStep("fetch_task", () =>
          this.deps.posthogClient.getTask(taskId),
        )
      : await this.createTask(input);

    if (importedClaude && input.repoPath) {
      await this.recordClaudeImport(input, importedClaude, task.id);
    }

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
            allowRemoteBranchCheckout: input.allowRemoteBranchCheckout,
            reuseExistingWorktree: input.reuseExistingWorktree,
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

      // Link after the workspace row exists, so the branch-mismatch prompt can
      // compare the session's branch against the live checkout.
      if (importedClaude) {
        this.linkImportedSessionBranch(input, task.id);
        workspace.linkedBranch =
          input.importedClaudeSession?.branch ?? workspace.linkedBranch;
      }
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

    // Channels "generic chat box": a repo-less local/worktree task still starts
    // an agent, in a per-task scratch dir. Provision it before signalling the
    // task is ready so the task view resolves the scratch dir as its cwd (a
    // synthetic local workspace) instead of showing the repo-picker prompt.
    let scratchCwd: string | null = null;
    if (
      !repoPath &&
      !input.taskId &&
      workspaceMode !== "cloud" &&
      input.allowNoRepo
    ) {
      scratchCwd = await this.readOnlyStep("scratch_dir", () =>
        this.deps.host.ensureScratchDir(task.id),
      );
    }

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

          // The local connect path appends channel CONTEXT.md to initialPrompt
          // and gets the user's personalization via the workspace-server system
          // prompt; cloud sends its first message as text and has no client-side
          // system-prompt seam, so fold both blocks into pendingUserMessage here.
          // The conversation UI parses them identically. Order: user's message,
          // then personalization (user-level), then channel context (workspace-
          // level background).
          const messageText = transport?.messageText;
          // Personalization augments the user's first message — fold it in only
          // when there is message text to augment. A file-only upload with no
          // typed text has nothing to personalize, and a block-only message
          // would strip to an empty bubble in the UI and get deduped against the
          // sandbox echo, leaving a blank placeholder. Channel context renders as
          // a chip even alone, so it isn't gated this way.
          const customInstructionsText = messageText
            ? buildCustomInstructionsText(input.customInstructions)
            : null;
          const channelContextText = buildChannelContextText(
            input.channelContext,
            input.channelName,
          );
          const pendingUserMessage =
            [messageText, customInstructionsText, channelContextText]
              .filter((part): part is string => !!part)
              .join("\n\n") || undefined;

          // The sandbox echoes pendingUserMessage back once it boots; until then
          // the optimistic placeholder would show the bare task description with
          // no CONTEXT.md / personalization chip. Hand the augmented message to
          // the session service so it seeds the placeholder right away.
          if (
            (channelContextText || customInstructionsText) &&
            pendingUserMessage
          ) {
            this.deps.sessionService.rememberInitialCloudPrompt(
              task.id,
              pendingUserMessage,
            );
          }
          // A cloud run always needs an explicit runtime adapter — the API rejects
          // `initial_permission_mode` unless `runtime_adapter` is set. Callers that don't pick one
          // (e.g. canvas generation) default to claude, matching the local-connect default below.
          const cloudAdapter = input.adapter ?? "claude";
          const taskRun = await this.deps.posthogClient.createTaskRun(task.id, {
            environment: "cloud",
            mode: "interactive",
            branch,
            adapter: cloudAdapter,
            model: input.model,
            reasoningLevel: input.reasoningLevel,
            sandboxEnvironmentId: input.sandboxEnvironmentId,
            prAuthorshipMode,
            runSource: input.cloudRunSource ?? "manual",
            signalReportId: input.signalReportId,
            homeQuickAction: input.homeQuickActionLabel,
            initialPermissionMode:
              input.executionMode ??
              (cloudAdapter === "codex" ? "auto" : "plan"),
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

    const isCloudCreate = !input.taskId && workspaceMode === "cloud";
    const agentCwd =
      workspace?.worktreePath ??
      workspace?.folderPath ??
      repoPath ??
      scratchCwd;

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
          if (importedClaude) {
            connectParams.importedSessionId = importedClaude.importedSessionId;
            connectParams.adapter = "claude";
          }

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

  /**
   * Snapshot an existing Claude Code CLI transcript into the app's Claude
   * config dir so the agent session can resume it. On rollback the copied
   * transcript is removed so abandoned snapshots don't accumulate.
   */
  private async importClaudeSession(
    input: TaskCreationInput,
  ): Promise<ImportedClaudeCliSession | undefined> {
    const repoPath = input.repoPath;
    if (
      input.taskId ||
      !input.importedClaudeSession ||
      !repoPath ||
      (input.workspaceMode ?? "local") !== "local"
    ) {
      return undefined;
    }
    const { sourceSessionId } = input.importedClaudeSession;
    return this.step({
      name: "import_claude_session",
      execute: () =>
        this.deps.host.importClaudeCliSession({ repoPath, sourceSessionId }),
      rollback: (imported) =>
        this.deps.host.deleteClaudeCliImport({
          repoPath,
          importedSessionId: imported.importedSessionId,
        }),
    });
  }

  /**
   * Link the task to the branch the CLI session worked on (best-effort, no
   * checkout). The standard branch-mismatch prompt then offers to switch if
   * the local checkout is elsewhere — consistent with how the app handles
   * sending a message on a differing branch.
   */
  private linkImportedSessionBranch(
    input: TaskCreationInput,
    taskId: string,
  ): void {
    const branchName = input.importedClaudeSession?.branch;
    if (!branchName) return;
    this.deps.host.linkTaskBranch({ taskId, branchName }).catch((error) => {
      this.log.warn("Failed to link imported session branch", { error });
    });
  }

  /**
   * Persist the import tracking row so the source session lists as `imported`
   * and reopens to this task. A first-class step paired with the import: on
   * rollback the row is dropped (by imported session id), so a later-step
   * failure can never leave a row pointing at a discarded task. Awaited so it
   * is ordered before any step that could trigger that rollback.
   */
  private async recordClaudeImport(
    input: TaskCreationInput,
    imported: ImportedClaudeCliSession,
    taskId: string,
  ): Promise<void> {
    const sourceSessionId = input.importedClaudeSession?.sourceSessionId;
    const repoPath = input.repoPath;
    if (!sourceSessionId || !repoPath) return;
    const { importedSessionId, fingerprint } = imported;
    await this.step({
      name: "record_claude_import",
      execute: () =>
        this.deps.host.recordClaudeCliImport({
          sourceSessionId,
          importedSessionId,
          repoPath,
          taskId,
          fingerprint,
        }),
      rollback: () =>
        this.deps.host.deleteClaudeCliImportRecord({ importedSessionId }),
    });
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
          // The server associates the task with the report and records the implementation
          // task_run artefact — no relationship label is sent (associations are unlabelled).
          branch:
            input.workspaceMode === "cloud"
              ? (input.branch ?? null)
              : undefined,
          runtime_adapter:
            input.workspaceMode === "cloud"
              ? (input.adapter ?? null)
              : undefined,
          model:
            input.workspaceMode === "cloud" ? (input.model ?? null) : undefined,
          reasoning_effort:
            input.workspaceMode === "cloud"
              ? (input.reasoningLevel ?? null)
              : undefined,
          signal_report: input.signalReportId ?? undefined,
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
