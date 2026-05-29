export const LOGS_SERVICE = Symbol.for("posthog.workspace.logsService");

export interface ILogsService {
  fetchS3Logs(logUrl: string): Promise<string | null>;
  readLocalLogs(taskRunId: string): Promise<string | null>;
  writeLocalLogs(taskRunId: string, content: string): Promise<void>;
}
