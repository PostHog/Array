import { formatTokens } from "./spendAnalysisFormat";
import type {
  SpendAnalysisInputSizeRow,
  SpendAnalysisResponse,
} from "./spendAnalysisTypes";

// A single turn often calls several tools, and the backend's `share_of_scoped`
// splits full turn cost across every tool that turn touched -- so summing it
// across tools exceeds 100%, and whichever tool is most ubiquitous (Bash) looks
// artificially dominant. `share_attributed` / `cost_attributed_usd` fix this by
// splitting each turn's cost fractionally across its tools, so they reconcile
// to scoped spend. Prefer them once the backend serves them; fall back to the
// old co-occurrence share otherwise.
const TOP_TOOL_SHARE_THRESHOLD = 0.35;
const NO_TOOL_SHARE_THRESHOLD = 0.1;
// The largest-context bucket eating this much of scoped spend is worth calling
// out as the primary lever -- trimming context, not switching tools.
const LARGE_CONTEXT_SHARE_THRESHOLD = 0.4;
const LARGEST_BUCKET_LABEL = ">300k";

function hasAttributedCost(
  row: SpendAnalysisResponse["by_tool"]["items"][number],
): row is SpendAnalysisResponse["by_tool"]["items"][number] & {
  cost_attributed_usd: number;
  share_attributed: number;
} {
  return (
    typeof row.cost_attributed_usd === "number" &&
    typeof row.share_attributed === "number"
  );
}

function topToolSuggestion(
  toolItems: SpendAnalysisResponse["by_tool"]["items"],
): string | null {
  const top = toolItems[0];
  if (!top?.tool) return null;

  if (hasAttributedCost(top)) {
    if (top.share_attributed <= TOP_TOOL_SHARE_THRESHOLD) return null;
    return `${top.tool} was involved in ${Math.round(top.share_attributed * 100)}% of your PostHog Code spend when each turn's cost is split across the tools it used, averaging ${formatTokens(top.avg_input_tokens)} input tokens per call.`;
  }

  if (top.share_of_scoped <= TOP_TOOL_SHARE_THRESHOLD) return null;
  return `${top.tool} drives ${Math.round(top.share_of_scoped * 100)}% of your spend in this app, averaging ${formatTokens(top.avg_input_tokens)} input tokens per call.`;
}

function noToolSuggestion(
  toolItems: SpendAnalysisResponse["by_tool"]["items"],
): string | null {
  const noToolRow = toolItems.find((r) => r.tool === null);
  if (!noToolRow || noToolRow.share_of_scoped <= NO_TOOL_SHARE_THRESHOLD) {
    return null;
  }
  return `${Math.round(noToolRow.share_of_scoped * 100)}% of spend is generations with no tool call: text-only replies. Tighter prompts or stopping the agent earlier can cut this.`;
}

/** The bucket to call out: the `>300k` bucket if it clears the threshold,
 * otherwise whichever bucket has the highest cost share (a shop can cluster in
 * `200k-300k` without much landing in `>300k`). */
function largestContextSuggestion(
  rows: SpendAnalysisInputSizeRow[],
): string | null {
  if (rows.length === 0) return null;

  const largestBucket = rows.find((r) => r.bucket === LARGEST_BUCKET_LABEL);
  const topByCost = rows.reduce((max, r) =>
    r.share_of_scoped > max.share_of_scoped ? r : max,
  );

  const candidate =
    largestBucket &&
    largestBucket.share_of_scoped > LARGE_CONTEXT_SHARE_THRESHOLD
      ? largestBucket
      : topByCost.share_of_scoped > LARGE_CONTEXT_SHARE_THRESHOLD
        ? topByCost
        : null;

  if (!candidate) return null;

  return `${Math.round(candidate.share_of_scoped * 100)}% of your spend comes from calls with ${formatTokens(candidate.min_input_tokens)}+ input tokens. Trimming context is your biggest lever here: clear between unrelated tasks and avoid re-reading large files or command outputs.`;
}

export function deriveSpendSuggestions(data: SpendAnalysisResponse): string[] {
  const suggestions: string[] = [];
  const { summary } = data;
  const toolItems = data.by_tool.items;

  if (summary.total_cost_usd === 0) {
    return ["No LLM spend in the selected window."];
  }

  const codeShare =
    summary.scoped_cost_usd / Math.max(summary.total_cost_usd, 0.0001);
  if (codeShare > 0.7) {
    suggestions.push(
      `This app is ${Math.round(codeShare * 100)}% of your spend. Other AI products (background agents, posthog_ai) are minor here.`,
    );
  }

  if (data.by_input_size) {
    const inputSizeSuggestion = largestContextSuggestion(
      data.by_input_size.items,
    );
    if (inputSizeSuggestion) suggestions.push(inputSizeSuggestion);
  }

  if (summary.scoped_cost_usd > 0 && toolItems.length > 0) {
    const topSuggestion = topToolSuggestion(toolItems);
    if (topSuggestion) suggestions.push(topSuggestion);

    const noToolSuggestionText = noToolSuggestion(toolItems);
    if (noToolSuggestionText) suggestions.push(noToolSuggestionText);
  }

  if (suggestions.length === 0) {
    suggestions.push(
      "Your spend is fairly evenly distributed across tools. No single hotspot stands out.",
    );
  }

  return suggestions;
}
