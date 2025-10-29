import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import type { Recording } from "../shared/types";
import type {
  CloudRegion,
  OAuthTokenResponse,
  StoredOAuthTokens,
} from "../shared/types/oauth";

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
  repoPath: string;
  apiKey: string;
  apiHost: string;
  permissionMode?: string;
  autoProgress?: boolean;
  model?: string;
  executionMode?: "plan";
  runMode?: "local" | "cloud";
}

contextBridge.exposeInMainWorld("electronAPI", {
  storeApiKey: (apiKey: string): Promise<string> =>
    ipcRenderer.invoke("store-api-key", apiKey),
  retrieveApiKey: (encryptedKey: string): Promise<string | null> =>
    ipcRenderer.invoke("retrieve-api-key", encryptedKey),
  // OAuth API
  oauthStartFlow: (
    region: CloudRegion,
  ): Promise<{ success: boolean; data?: OAuthTokenResponse; error?: string }> =>
    ipcRenderer.invoke("oauth:start-flow", region),
  oauthEncryptTokens: (
    tokens: StoredOAuthTokens,
  ): Promise<{ success: boolean; encrypted?: string; error?: string }> =>
    ipcRenderer.invoke("oauth:encrypt-tokens", tokens),
  oauthRetrieveTokens: (
    encrypted: string,
  ): Promise<{ success: boolean; data?: StoredOAuthTokens; error?: string }> =>
    ipcRenderer.invoke("oauth:retrieve-tokens", encrypted),
  oauthDeleteTokens: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("oauth:delete-tokens"),
  oauthRefreshToken: (
    refreshToken: string,
    region: CloudRegion,
  ): Promise<{ success: boolean; data?: OAuthTokenResponse; error?: string }> =>
    ipcRenderer.invoke("oauth:refresh-token", refreshToken, region),
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
  // Plan mode operations
  agentStartPlanMode: async (params: {
    taskId: string;
    taskTitle: string;
    taskDescription: string;
    repoPath: string;
    apiKey: string;
    apiHost: string;
  }): Promise<{ taskId: string; channel: string }> =>
    ipcRenderer.invoke("agent-start-plan-mode", params),
  agentGeneratePlan: async (params: {
    taskId: string;
    taskTitle: string;
    taskDescription: string;
    repoPath: string;
    questionAnswers: unknown[];
    apiKey: string;
    apiHost: string;
  }): Promise<{ taskId: string; channel: string }> =>
    ipcRenderer.invoke("agent-generate-plan", params),
  readPlanFile: (repoPath: string, taskId: string): Promise<string | null> =>
    ipcRenderer.invoke("read-plan-file", repoPath, taskId),
  writePlanFile: (
    repoPath: string,
    taskId: string,
    content: string,
  ): Promise<void> =>
    ipcRenderer.invoke("write-plan-file", repoPath, taskId, content),
  ensurePosthogFolder: (repoPath: string, taskId: string): Promise<string> =>
    ipcRenderer.invoke("ensure-posthog-folder", repoPath, taskId),
  listTaskArtifacts: (repoPath: string, taskId: string): Promise<unknown[]> =>
    ipcRenderer.invoke("list-task-artifacts", repoPath, taskId),
  readTaskArtifact: (
    repoPath: string,
    taskId: string,
    fileName: string,
  ): Promise<string | null> =>
    ipcRenderer.invoke("read-task-artifact", repoPath, taskId, fileName),
  appendToArtifact: (
    repoPath: string,
    taskId: string,
    fileName: string,
    content: string,
  ): Promise<void> =>
    ipcRenderer.invoke(
      "append-to-artifact",
      repoPath,
      taskId,
      fileName,
      content,
    ),
  saveQuestionAnswers: (
    repoPath: string,
    taskId: string,
    answers: Array<{
      questionId: string;
      selectedOption: string;
      customInput?: string;
    }>,
  ): Promise<void> =>
    ipcRenderer.invoke("save-question-answers", repoPath, taskId, answers),
  onOpenSettings: (listener: () => void): (() => void) => {
    const wrapped = () => listener();
    ipcRenderer.on("open-settings", wrapped);
    return () => ipcRenderer.removeListener("open-settings", wrapped);
  },
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
  onUpdateReady: (listener: () => void): (() => void) => {
    const channel = "updates:ready";
    const wrapped = () => listener();
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  installUpdate: (): Promise<{ installed: boolean }> =>
    ipcRenderer.invoke("updates:install"),
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
  // Shell API
  shellCreate: (sessionId: string, cwd?: string): Promise<void> =>
    ipcRenderer.invoke("shell:create", sessionId, cwd),
  shellWrite: (sessionId: string, data: string): Promise<void> =>
    ipcRenderer.invoke("shell:write", sessionId, data),
  shellResize: (sessionId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke("shell:resize", sessionId, cols, rows),
  shellDestroy: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("shell:destroy", sessionId),
  onShellData: (
    sessionId: string,
    listener: (data: string) => void,
  ): (() => void) => {
    const channel = `shell:data:${sessionId}`;
    const wrapped = (_event: IpcRendererEvent, data: string) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onShellExit: (sessionId: string, listener: () => void): (() => void) => {
    const channel = `shell:exit:${sessionId}`;
    const wrapped = () => listener();
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
