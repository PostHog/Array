export interface SpendAnalysisSummary {
  date_from: string;
  date_to: string;
  product: string | null;
  total_cost_usd: number;
  event_count: number;
  scoped_cost_usd: number;
  scoped_event_count: number;
}

export interface SpendAnalysisProductRow {
  product: string | null;
  event_count: number;
  cost_usd: number;
}

export interface SpendAnalysisToolRow {
  tool: string | null;
  generation_count: number;
  cost_usd: number;
  share_of_scoped: number;
  avg_input_tokens: number;
}

export interface SpendAnalysisModelRow {
  model: string | null;
  generation_count: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface SpendAnalysisDayRow {
  day: string;
  event_count: number;
  cost_usd: number;
}

// Per-bucket cost split into the LLM gateway's cost-breakdown components.
// `cost_usd` is authoritative: fallback-priced events carry only the total,
// so the components can sum to less — render any remainder as uncategorized.
export interface SpendAnalysisBucketRow {
  bucket_start: string;
  event_count: number;
  cost_usd: number;
  input_cost_usd: number;
  output_cost_usd: number;
  cache_read_cost_usd: number;
  cache_creation_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface SpendAnalysisBreakdown<TRow> {
  items: TRow[];
  truncated: boolean;
}

export interface SpendAnalysisBucketBreakdown
  extends SpendAnalysisBreakdown<SpendAnalysisBucketRow> {
  // Bucket size in minutes the series was computed at — echoes the request.
  bucket_minutes: number;
}

export interface SpendAnalysisResponse {
  summary: SpendAnalysisSummary;
  by_product: SpendAnalysisBreakdown<SpendAnalysisProductRow>;
  by_tool: SpendAnalysisBreakdown<SpendAnalysisToolRow>;
  by_model: SpendAnalysisBreakdown<SpendAnalysisModelRow>;
  // Optional until the backend by_day rollout reaches every deployment.
  by_day?: SpendAnalysisBreakdown<SpendAnalysisDayRow>;
  // Only present when the request set `bucketMinutes` (and the backend
  // supports it) — time-ascending UTC series, at most 600 buckets per window.
  by_bucket?: SpendAnalysisBucketBreakdown;
  // `top_traces` is still in the backend response shape (always empty) per
  // posthog/posthog#59796. Renderer code does not consume it; left out of the
  // TS type so future readers see only what we actually use.
}
