import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import type { Recording } from "../shared/types";

interface MessageBoxOptions {
  type?: "info" | "error" | "warning" | "question";
  title?: string;
  message?: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
}

interface AgentStartParams {
  taskId: string;
  workflowId: string;
  repoPath: string;
  apiKey: string;
  apiHost: string;
  permissionMode?: string;
  autoProgress?: boolean;
  model?: string;
}

contextBridge.exposeInMainWorld("electronAPI", {
  storeApiKey: (apiKey: string): Promise<string> =>
    ipcRenderer.invoke("store-api-key", apiKey),
  retrieveApiKey: (encryptedKey: string): Promise<string | null> =>
    ipcRenderer.invoke("retrieve-api-key", encryptedKey),
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("select-directory"),
  searchDirectories: (query: string, searchRoot?: string): Promise<string[]> =>
    ipcRenderer.invoke("search-directories", query, searchRoot),
  validateRepo: (directoryPath: string): Promise<boolean> =>
    ipcRenderer.invoke("validate-repo", directoryPath),
  checkWriteAccess: (directoryPath: string): Promise<boolean> =>
    ipcRenderer.invoke("check-write-access", directoryPath),
  detectRepo: (
    directoryPath: string,
  ): Promise<{
    organization: string;
    repository: string;
    branch?: string;
    remote?: string;
  } | null> => ipcRenderer.invoke("detect-repo", directoryPath),
  showMessageBox: (options: MessageBoxOptions): Promise<{ response: number }> =>
    ipcRenderer.invoke("show-message-box", options),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("open-external", url),
  listRepoFiles: (
    repoPath: string,
    query?: string,
  ): Promise<Array<{ path: string; name: string }>> =>
    ipcRenderer.invoke("list-repo-files", repoPath, query),
  agentStart: async (
    params: AgentStartParams,
  ): Promise<{ taskId: string; channel: string }> =>
    ipcRenderer.invoke("agent-start", params),
  agentCancel: async (taskId: string): Promise<boolean> =>
    ipcRenderer.invoke("agent-cancel", taskId),
  onAgentEvent: (
    channel: string,
    listener: (payload: unknown) => void,
  ): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: unknown) =>
      listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onOpenSettings: (listener: () => void): (() => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("open-settings", wrapped);
    return () => ipcRenderer.removeListener("open-settings", wrapped);
  },
  // Recording API
  recordingStart: (): Promise<{ recordingId: string; startTime: string }> =>
    ipcRenderer.invoke("recording:start"),
  recordingStop: (
    recordingId: string,
    audioData: Uint8Array,
    duration: number,
  ): Promise<Recording> =>
    ipcRenderer.invoke("recording:stop", recordingId, audioData, duration),
  recordingList: (): Promise<Recording[]> =>
    ipcRenderer.invoke("recording:list"),
  recordingDelete: (recordingId: string): Promise<boolean> =>
    ipcRenderer.invoke("recording:delete", recordingId),
  recordingGetFile: (recordingId: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke("recording:get-file", recordingId),
  recordingTranscribe: (
    recordingId: string,
    openaiApiKey: string,
  ): Promise<{
    status: string;
    text: string;
    summary?: string | null;
    extracted_tasks?: Array<{ title: string; description: string }>;
  }> => ipcRenderer.invoke("recording:transcribe", recordingId, openaiApiKey),
  // Desktop capturer for system audio
  getDesktopSources: async (options: { types: ("screen" | "window")[] }) => {
    return await ipcRenderer.invoke("desktop-capturer:get-sources", options);
  },
});
