import type { AgentEvent } from "@posthog/agent";
import type { QuestionAnswer, TaskArtifact } from "@shared/types";

export interface IElectronAPI {
  storeApiKey: (apiKey: string) => Promise<string>;
  retrieveApiKey: (encryptedKey: string) => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;
  searchDirectories: (query: string, searchRoot?: string) => Promise<string[]>;
  validateRepo: (directoryPath: string) => Promise<boolean>;
  checkWriteAccess: (directoryPath: string) => Promise<boolean>;
  showMessageBox: (options: {
    type?: "none" | "info" | "error" | "question" | "warning";
    title?: string;
    message?: string;
    detail?: string;
    buttons?: string[];
    defaultId?: number;
    cancelId?: number;
  }) => Promise<{ response: number }>;
  openExternal: (url: string) => Promise<void>;
  listRepoFiles: (
    repoPath: string,
    query?: string,
  ) => Promise<Array<{ path: string; name: string }>>;
  agentStart: (params: {
    taskId: string;
    workflowId: string;
    repoPath: string;
    apiKey: string;
    apiHost: string;
    permissionMode?: string;
    autoProgress?: boolean;
    model?: string;
  }) => Promise<{ taskId: string; channel: string }>;
  agentCancel: (taskId: string) => Promise<boolean>;
  onAgentEvent: (
    channel: string,
    listener: (event: AgentEvent) => void,
  ) => () => void;
  // Plan mode operations
  agentStartPlanMode: (params: {
    taskId: string;
    taskTitle: string;
    taskDescription: string;
    repoPath: string;
    apiKey: string;
    apiHost: string;
  }) => Promise<{ taskId: string; channel: string }>;
  agentGeneratePlan: (params: {
    taskId: string;
    taskTitle: string;
    taskDescription: string;
    repoPath: string;
    questionAnswers: QuestionAnswer[];
    apiKey: string;
    apiHost: string;
  }) => Promise<{ taskId: string; channel: string }>;
  readPlanFile: (repoPath: string, taskId: string) => Promise<string | null>;
  writePlanFile: (
    repoPath: string,
    taskId: string,
    content: string,
  ) => Promise<void>;
  ensurePosthogFolder: (repoPath: string, taskId: string) => Promise<string>;
  listTaskArtifacts: (
    repoPath: string,
    taskId: string,
  ) => Promise<TaskArtifact[]>;
  readTaskArtifact: (
    repoPath: string,
    taskId: string,
    fileName: string,
  ) => Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
