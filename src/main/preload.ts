import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

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
  prompt: string;
  repoPath: string;
  model?: string;
}

contextBridge.exposeInMainWorld("electronAPI", {
  storeApiKey: (apiKey: string): Promise<string> =>
    ipcRenderer.invoke("store-api-key", apiKey),
  retrieveApiKey: (encryptedKey: string): Promise<string | null> =>
    ipcRenderer.invoke("retrieve-api-key", encryptedKey),
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("select-directory"),
  validateRepo: (directoryPath: string): Promise<boolean> =>
    ipcRenderer.invoke("validate-repo", directoryPath),
  checkWriteAccess: (directoryPath: string): Promise<boolean> =>
    ipcRenderer.invoke("check-write-access", directoryPath),
  showMessageBox: (options: MessageBoxOptions): Promise<{ response: number }> =>
    ipcRenderer.invoke("show-message-box", options),
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
  recordingStart: (): Promise<{ recordingId: string; startTime: string }> =>
    ipcRenderer.invoke("recording:start"),
  recordingStop: (
    recordingId: string,
    audioData: Uint8Array,
    duration: number,
  ): Promise<unknown> =>
    ipcRenderer.invoke("recording:stop", recordingId, audioData, duration),
  recordingList: (): Promise<unknown[]> =>
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
    extracted_tasks?: Array<{ title: string; description: string }>
  }> =>
    ipcRenderer.invoke("recording:transcribe", recordingId, openaiApiKey),
  onMeetingDetected: (
    listener: () => void,
  ): (() => void) => {
    const wrapped = (_event: IpcRendererEvent) => listener();
    ipcRenderer.on("meeting:start-recording", wrapped);
    return () => ipcRenderer.removeListener("meeting:start-recording", wrapped);
  },
});
