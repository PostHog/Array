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
});
