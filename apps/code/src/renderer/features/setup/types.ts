export type DiscoveredTaskSource = "agent" | "enricher";

export interface DiscoveredTask {
  id: string;
  title: string;
  description: string;
  category:
    | "bug"
    | "security"
    | "dead_code"
    | "duplication"
    | "performance"
    | "stale_feature_flag"
    | "error_tracking"
    | "event_tracking"
    | "funnel"
    | "posthog_setup";
  source: DiscoveredTaskSource;
  file?: string;
  lineHint?: number;
  impact?: string;
  recommendation?: string;
  prompt?: string;
}

export const TASK_DISCOVERY_JSON_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "A short kebab-case identifier" },
          title: {
            type: "string",
            description:
              "Short, action-oriented header — under 60 characters. No file paths or line numbers.",
          },
          description: {
            type: "string",
            description:
              "A clear paragraph (2–4 sentences) describing the problem: what's wrong and the conditions under which it manifests. Do NOT include the file path or line number — those go in the file/lineHint fields.",
          },
          category: {
            type: "string",
            enum: [
              "bug",
              "security",
              "dead_code",
              "duplication",
              "performance",
              "stale_feature_flag",
              "error_tracking",
              "event_tracking",
              "funnel",
            ],
          },
          file: {
            type: "string",
            description: "Relative file path where the issue lives",
          },
          lineHint: {
            type: "integer",
            description: "Approximate line number",
          },
          impact: {
            type: "string",
            description:
              "Why this matters — concrete impact, blast radius, or risk. 1–3 sentences. Be specific (e.g. 'silently drops auth errors so users see a successful login UI even when backend rejects them').",
          },
          recommendation: {
            type: "string",
            description:
              "Suggested approach to fix, in plain prose. 2–4 sentences pointing at the right shape of the fix without writing the patch. Reference any specific functions, types, or files involved.",
          },
        },
        required: [
          "id",
          "title",
          "description",
          "category",
          "impact",
          "recommendation",
        ],
      },
      maxItems: 4,
    },
  },
  required: ["tasks"],
} as const;
