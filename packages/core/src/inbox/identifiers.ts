export const INBOX_BULK_ACTION_SERVICE = Symbol.for(
  "posthog.core.inbox.bulkActionService",
);
export const SIGNAL_SOURCE_SERVICE = Symbol.for(
  "posthog.core.inbox.signalSourceService",
);
export const SIGNAL_REPORT_TASK_SERVICE = Symbol.for(
  "posthog.core.inbox.signalReportTaskService",
);
export const REPORT_MODEL_RESOLVER = Symbol.for(
  "posthog.core.inbox.reportModelResolver",
);
export const DATA_SOURCE_SERVICE = Symbol.for(
  "posthog.core.inbox.dataSourceService",
);
export const LINEAR_OAUTH_FLOW = Symbol.for(
  "posthog.core.inbox.linearOAuthFlow",
);

export interface ReportModelResolver {
  resolveDefaultModel(
    apiHost: string,
    adapter: "claude" | "codex",
  ): Promise<string | undefined>;
}

export interface LinearOAuthFlow {
  startFlow(region: string, projectId: number): Promise<void>;
}
