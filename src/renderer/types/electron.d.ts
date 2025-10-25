import type { AgentEvent } from "@posthog/agent";
import type { TaskArtifact } from "@shared/types";
import type { Recording } from "@shared/types";

export interface IElectronAPI {
  storeApiKey: (apiKey: string) => Promise<string>;
  retrieveApiKey: (encryptedKey: string) => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;
  searchDirectories: (query: string, searchRoot?: string) => Promise<string[]>;
  validateRepo: (directoryPath: string) => Promise<boolean>;
  checkWriteAccess: (directoryPath: string) => Promise<boolean>;
  detectRepo: (directoryPath: string) => Promise<{
    organization: string;
    repository: string;
    branch?: string;
    remote?: string;
  } | null>;
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
    repoPath: string;
    apiKey: string;
    apiHost: string;
    permissionMode?: string;
    autoProgress?: boolean;
    model?: string;
    executionMode?: "plan";
    runMode?: "local" | "cloud";
  }) => Promise<{ taskId: string; channel: string }>;
  agentCancel: (taskId: string) => Promise<boolean>;
  onAgentEvent: (
    channel: string,
    listener: (event: AgentEvent) => void,
  ) => () => void;
  // Task artifact operations
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
  appendToArtifact: (
    repoPath: string,
    taskId: string,
    fileName: string,
    content: string,
  ) => Promise<void>;
  saveQuestionAnswers: (
    repoPath: string,
    taskId: string,
    answers: Array<{
      questionId: string;
      selectedOption: string;
      customInput?: string;
    }>,
  ) => Promise<void>;
  onOpenSettings: (listener: () => void) => () => void;
  onUpdateReady: (listener: () => void) => () => void;
  installUpdate: () => Promise<{ installed: boolean }>;
  // Recording API
  recordingStart: () => Promise<{ recordingId: string; startTime: string }>;
  recordingStop: (
    recordingId: string,
    audioData: Uint8Array,
    duration: number,
  ) => Promise<Recording>;
  recordingList: () => Promise<Recording[]>;
  recordingDelete: (recordingId: string) => Promise<boolean>;
  recordingGetFile: (recordingId: string) => Promise<ArrayBuffer>;
  recordingTranscribe: (
    recordingId: string,
    openaiApiKey: string,
  ) => Promise<{
    status: string;
    text: string;
    summary?: string | null;
    extracted_tasks?: Array<{ title: string; description: string }>;
  }>;
  // Desktop capturer for system audio
  getDesktopSources: (options: { types: string[] }) => Promise<
    Array<{
      id: string;
      name: string;
    }>
  >;
  // Shell API
  shellCreate: (sessionId: string, cwd?: string) => Promise<void>;
  shellWrite: (sessionId: string, data: string) => Promise<void>;
  shellResize: (sessionId: string, cols: number, rows: number) => Promise<void>;
  shellDestroy: (sessionId: string) => Promise<void>;
  onShellData: (
    sessionId: string,
    listener: (data: string) => void,
  ) => () => void;
  onShellExit: (sessionId: string, listener: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
