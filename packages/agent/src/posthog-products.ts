/**
 * PostHog product classification for MCP `exec` sub-tools.
 *
 * The PostHog MCP exposes a single `exec` dispatcher whose `call <sub-tool> …`
 * verb invokes a concrete resource tool (e.g. `experiment-list`,
 * `feature-flag-update`, `execute-sql`, `query-trends`). The sub-tool name is
 * `<domain>-<action>` (or `query-<type>`), and the domain identifies which
 * PostHog product the call touched.
 *
 * `classifyPostHogSubTool` turns a sub-tool name into a stable product id so the
 * agent can report, per turn, which products an answer was grounded in. This is
 * the single source of truth for the product id → label set; the renderer maps
 * ids to icons/styling for display.
 */

/** Canonical PostHog products, keyed by stable id with a display label. */
export const POSTHOG_PRODUCTS = {
  product_analytics: "Product analytics",
  web_analytics: "Web analytics",
  feature_flags: "Feature flags",
  experiments: "Experiments",
  error_tracking: "Error tracking",
  session_replay: "Session replay",
  surveys: "Surveys",
  llm_analytics: "LLM analytics",
  data_warehouse: "Data warehouse",
  cdp: "Data pipelines",
  logs: "Logs",
  apm: "APM",
  sql: "SQL",
  /** Generic fallback for a recognized-PostHog call we don't classify yet. */
  posthog: "PostHog",
} as const;

export type PostHogProductId = keyof typeof POSTHOG_PRODUCTS;

/**
 * Domain prefix → product, or `null` for admin/meta/introspection domains we
 * deliberately do not surface (listing projects, reading the activity log,
 * managing tasks, searching docs, …). A sub-tool whose domain is absent here
 * falls back to the generic `posthog` product rather than disappearing.
 */
const DOMAIN_PRODUCT: Record<string, PostHogProductId | null> = {
  // Experiments
  experiment: "experiments",
  // Feature flags
  "feature-flag": "feature_flags",
  "early-access-feature": "feature_flags",
  "scheduled-changes": "feature_flags",
  // Error tracking
  "error-tracking": "error_tracking",
  // Session replay
  "session-recording": "session_replay",
  "visual-review": "session_replay",
  // Surveys
  survey: "surveys",
  // LLM analytics
  llm: "llm_analytics",
  "llma-evaluation-judge-models": "llm_analytics",
  "llma-personal-spend": "llm_analytics",
  "llma-tagger-test-hog": "llm_analytics",
  "agent-feedback": "llm_analytics",
  // Data warehouse
  "external-data-sources": "data_warehouse",
  "external-data-schemas": "data_warehouse",
  "external-data-sync-logs": "data_warehouse",
  "read-data-warehouse-schema": "data_warehouse",
  "read-data-schema": "data_warehouse",
  "batch-export": "data_warehouse",
  // Data pipelines (CDP)
  "cdp-functions": "cdp",
  "cdp-function-templates": "cdp",
  "hog-flows-logs": "cdp",
  "hog-flows-metrics": "cdp",
  workflows: "cdp",
  // Logs / APM
  logs: "logs",
  apm: "apm",
  // SQL
  "execute-sql": "sql",
  // Web analytics
  "web-analytics-weekly-digest": "web_analytics",
  // Product analytics
  insight: "product_analytics",
  dashboard: "product_analytics",
  action: "product_analytics",
  cohorts: "product_analytics",
  persons: "product_analytics",
  annotation: "product_analytics",
  endpoint: "product_analytics",
  view: "product_analytics",
  "usage-metrics": "product_analytics",
  subscriptions: "product_analytics",
  alert: "product_analytics",
  notebooks: "product_analytics",
  // Admin / meta / introspection — recognized but not surfaced.
  project: null,
  user: null,
  accounts: null,
  integration: null,
  "activity-log": null,
  "advanced-activity-logs": null,
  "approval-policy": null,
  "approval-policies": null,
  "change-request": null,
  "docs-search": null,
  "sdk-doctor": null,
  tasks: null,
  "inbox-reports": null,
  "inbox-source-configs": null,
  "signals-scout-runs": null,
  "signals-scout-scratchpad-search": null,
  comment: null,
};

const KNOWN_DOMAINS = Object.keys(DOMAIN_PRODUCT);

/** Classify a `query-<type>` sub-tool by its query type. */
function classifyQuery(type: string): PostHogProductId | null {
  if (type.startsWith("error-tracking")) return "error_tracking";
  if (type.startsWith("session-recording")) return "session_replay";
  if (type.startsWith("llm")) return "llm_analytics";
  if (type === "logs") return "logs";
  if (type.startsWith("apm")) return "apm";
  // trends / funnel / retention / lifecycle / stickiness / paths (+ -actors)
  return "product_analytics";
}

/**
 * Map a PostHog MCP `call` sub-tool (e.g. `feature-flag-update`, `query-trends`)
 * to a product id. Returns `null` when the sub-tool is an admin/meta domain we
 * deliberately don't surface, or when the name is empty.
 */
export function classifyPostHogSubTool(
  subTool: string,
): PostHogProductId | null {
  const name = subTool.trim().toLowerCase();
  if (!name) return null;

  if (name === "query" || name.startsWith("query-")) {
    return classifyQuery(name.slice("query-".length));
  }

  // Longest matching domain wins so `feature-flag` beats a hypothetical
  // `feature` and multi-word domains aren't shadowed by shorter prefixes.
  let best: string | null = null;
  for (const domain of KNOWN_DOMAINS) {
    if (name === domain || name.startsWith(`${domain}-`)) {
      if (best === null || domain.length > best.length) best = domain;
    }
  }

  if (best === null) return "posthog";
  return DOMAIN_PRODUCT[best];
}
