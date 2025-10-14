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
    listener: (event: unknown) => void,
  ) => () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
