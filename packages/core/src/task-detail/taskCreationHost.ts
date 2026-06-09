import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { Workspace, WorkspaceMode } from "@posthog/shared";
import type { TaskCreationApiClient } from "./taskCreationApiClient";

export interface CloudPromptTransport {
  filePaths: string[];
  messageText?: string;
  promptText: string;
}

export interface CreateWorkspaceArgs {
  taskId: string;
  mainRepoPath: string;
  folderId: string;
  folderPath: string;
  mode: WorkspaceMode;
  branch?: string;
}

export interface CreatedWorkspaceInfo {
  worktree?: {
    worktreePath?: string | null;
    worktreeName?: string | null;
    branchName?: string | null;
    baseBranch?: string | null;
    createdAt?: string | null;
  } | null;
  linkedBranch?: string | null;
}

export interface TaskFolderInfo {
  id: string;
  path: string;
}

export interface DetectedRepo {
  organization: string;
  repository: string;
}

export interface TaskEnvironment {
  name: string;
  setup?: { script?: string | null } | null;
}

export interface SetupActionDispatch {
  taskId: string;
  command: string;
  cwd: string;
  label: string;
}

export interface ITaskCreationHost {
  getAuthenticatedClient(): Promise<TaskCreationApiClient | null>;
  assertCloudUsageAvailable(): Promise<void>;
  getTaskDirectory(taskId: string, repoKey?: string): Promise<string | null>;
  getWorkspace(taskId: string): Promise<Workspace | null>;
  createWorkspace(args: CreateWorkspaceArgs): Promise<CreatedWorkspaceInfo>;
  deleteWorkspace(args: {
    taskId: string;
    mainRepoPath: string;
  }): Promise<void>;
  getFolders(): Promise<TaskFolderInfo[]>;
  addFolder(args: { folderPath: string }): Promise<TaskFolderInfo>;
  addAdditionalDirectory(args: { taskId: string; path: string }): Promise<void>;
  removeAdditionalDirectory(args: {
    taskId: string;
    path: string;
  }): Promise<void>;
  getEnvironment(args: {
    repoPath: string;
    id: string;
  }): Promise<TaskEnvironment | null>;
  detectRepo(args: { directoryPath: string }): Promise<DetectedRepo | null>;
  getCloudPromptTransport(
    prompt: string | ContentBlock[],
    filePaths?: string[],
  ): CloudPromptTransport;
  uploadRunAttachments(
    client: TaskCreationApiClient,
    taskId: string,
    runId: string,
    filePaths: string[],
  ): Promise<string[]>;
  setProvisioningActive(taskId: string): void;
  clearProvisioning(taskId: string): void;
  dispatchSetupAction(args: SetupActionDispatch): void;
  track(event: string, props?: Record<string, unknown>): void;
}
