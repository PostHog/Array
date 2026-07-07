export const BILLING_FLAG = "posthog-code-billing";
export const SPEND_ANALYSIS_FLAG = "posthog-code-spend-analysis";
export const EXPERIMENT_SUGGESTIONS_FLAG =
  "posthog-code-experiment-suggestions";
export const SYNC_CLOUD_TASKS_FLAG = "posthog-code-sync-cloud-tasks";
/** Autoresearch (metric-optimization loop). Staff-gated while it bakes. */
export const AUTORESEARCH_FLAG = "posthog-code-autoresearch";
export const HOME_TAB_FLAG = "posthog-code-home-tab";
export const DISCOVERY_RUN_FLAG = "posthog-code-discovery-run";
// Gates the entire canvas feature: the app rail's Channels space, the /website
// routes, channels and dashboards.
export const PROJECT_BLUEBIRD_FLAG = "project-bluebird";
export const TASKS_PREWARM_SANDBOX_FLAG = "tasks-prewarm-sandbox";
export const GLM_MODEL_FLAG = "posthog-code-glm-model";
// Gates forwarding the user's local (~/.claude.json) url-based MCP servers
// into cloud task runs.
export const LOCAL_MCP_IMPORT_FLAG = "posthog-code-local-mcp-import";
