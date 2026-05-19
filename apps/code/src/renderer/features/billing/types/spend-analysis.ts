export interface SpendAnalysisSummary {
  period_days: number;
  total_cost_usd: number;
  event_count: number;
  posthog_code_cost_usd: number;
  posthog_code_event_count: number;
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
  avg_input_tokens: number;
}

export interface SpendAnalysisModelRow {
  model: string | null;
  generation_count: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface SpendAnalysisTraceRow {
  trace_id: string | null;
  generation_count: number;
  cost_usd: number;
  started_at: string | null;
}

export interface SpendAnalysisResponse {
  summary: SpendAnalysisSummary;
  by_product: SpendAnalysisProductRow[];
  by_tool: SpendAnalysisToolRow[];
  by_model: SpendAnalysisModelRow[];
  top_traces: SpendAnalysisTraceRow[];
}
