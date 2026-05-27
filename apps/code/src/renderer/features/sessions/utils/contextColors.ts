import type { ContextBreakdown } from "@features/sessions/hooks/useContextUsage";

export interface CategoryStyle {
  key: keyof ContextBreakdown;
  label: string;
  color: string;
}

export const CONTEXT_CATEGORIES: readonly CategoryStyle[] = [
  { key: "systemPrompt", label: "System prompt", color: "var(--gray-9)" },
  { key: "tools", label: "Tools", color: "var(--violet-9)" },
  { key: "rules", label: "Rules", color: "var(--green-9)" },
  { key: "skills", label: "Skills", color: "var(--amber-9)" },
  { key: "mcp", label: "MCP", color: "var(--pink-9)" },
  { key: "subagents", label: "Subagents", color: "var(--blue-9)" },
  { key: "conversation", label: "Conversation", color: "var(--orange-9)" },
] as const;

export function getOverallUsageColor(percentage: number): string {
  if (percentage >= 90) return "var(--red-9)";
  if (percentage >= 75) return "var(--orange-9)";
  if (percentage >= 50) return "var(--amber-9)";
  return "var(--green-9)";
}

export function formatTokensCompact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return tokens.toString();
}
