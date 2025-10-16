import type { AgentEvent } from "@posthog/agent";
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
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
