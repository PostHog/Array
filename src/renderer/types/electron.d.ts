import type { Recording } from "@shared/types";

export interface IElectronAPI {
  storeApiKey: (apiKey: string) => Promise<string>;
  retrieveApiKey: (encryptedKey: string) => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;
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
  agentStart: (params: {
    prompt: string;
    repoPath: string;
    model?: string;
  }) => Promise<{ taskId: string; channel: string }>;
  agentCancel: (taskId: string) => Promise<boolean>;
  onAgentEvent: (
    channel: string,
    listener: (event: unknown) => void,
  ) => () => void;
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
    extracted_tasks?: Array<{ title: string; description: string }>
  }>;
  onMeetingDetected: (listener: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
