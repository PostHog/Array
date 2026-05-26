/**
 * Per-source context-window token breakdown for the renderer's
 * `ContextBreakdownPopover`. Anthropic doesn't break down `input_tokens` by
 * source, so we tokenize the pieces we control client-side using a cheap
 * character-ratio estimator (~3.5 chars/token). Numbers are indicative, not
 * invoice-grade — used only for relative-share UX.
 */

export type ContextCategory =
  | "systemPrompt"
  | "tools"
  | "rules"
  | "skills"
  | "mcp"
  | "subagents"
  | "conversation";

export type ContextBreakdown = Record<ContextCategory, number>;

// Rough estimate of Claude's bundled `claude_code` preset system prompt. The
// preset content is opaque to us so we add this constant when the systemPrompt
// uses the preset — otherwise it'd show up as Conversation and skew the chart.
const CLAUDE_PRESET_ESTIMATE_TOKENS = 4000;

const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN));
}

export function estimateJsonTokens(value: unknown): number {
  try {
    return estimateTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

interface SlashCommandLike {
  name?: string;
  description?: string;
  input?: { hint?: string } | null;
}

/** Tokens for the slash-command list the SDK injects into the system prompt. */
export function estimateSkillsTokens(commands: SlashCommandLike[]): number {
  if (!commands.length) return 0;
  return estimateJsonTokens(
    commands.map((c) => ({
      name: c.name,
      description: c.description,
      hint: c.input?.hint,
    })),
  );
}

interface McpToolLike {
  name?: string;
  description?: string;
}

/** Tokens for the connected MCP tools' name + description. The SDK doesn't
 *  inject their full input schemas into the prompt by default (it relies on
 *  tool search), so this is a conservative estimate of what's resident. */
export function estimateMcpTokens(tools: McpToolLike[]): number {
  if (!tools.length) return 0;
  return estimateJsonTokens(
    tools.map((t) => ({ name: t.name, description: t.description })),
  );
}

/** Tokens for the rules content appended to the system prompt (CLAUDE.md). */
export function estimateRulesTokens(rules: string | undefined): number {
  return estimateTokens(rules);
}

export interface ContextBreakdownBaseline {
  systemPrompt: number;
  tools: number;
  rules: number;
  skills: number;
  mcp: number;
  subagents: number;
}

export function emptyBaseline(): ContextBreakdownBaseline {
  return {
    systemPrompt: 0,
    tools: 0,
    rules: 0,
    skills: 0,
    mcp: 0,
    subagents: 0,
  };
}

/**
 * Estimate tokens for whatever shape `Options["systemPrompt"]` ended up being:
 * a raw string, a `{ type: "preset", append }` object, or undefined.
 */
export function estimateSystemPrompt(systemPrompt: unknown): number {
  if (!systemPrompt) return CLAUDE_PRESET_ESTIMATE_TOKENS;
  if (typeof systemPrompt === "string") return estimateTokens(systemPrompt);
  if (typeof systemPrompt === "object") {
    const obj = systemPrompt as { type?: string; append?: unknown };
    const appendTokens =
      typeof obj.append === "string" ? estimateTokens(obj.append) : 0;
    if (obj.type === "preset") {
      return CLAUDE_PRESET_ESTIMATE_TOKENS + appendTokens;
    }
    return appendTokens;
  }
  return 0;
}

/**
 * Derive the per-source breakdown from a stable baseline + the current turn's
 * input-token total. The conversation bucket is whatever is left after the
 * stable pieces are subtracted; it's floored at 0 to absorb estimation drift.
 */
export function buildBreakdown(
  baseline: ContextBreakdownBaseline,
  currentInputTokens: number,
): ContextBreakdown {
  const stableSum =
    baseline.systemPrompt +
    baseline.tools +
    baseline.rules +
    baseline.skills +
    baseline.mcp +
    baseline.subagents;
  const conversation = Math.max(0, currentInputTokens - stableSum);
  return {
    systemPrompt: baseline.systemPrompt,
    tools: baseline.tools,
    rules: baseline.rules,
    skills: baseline.skills,
    mcp: baseline.mcp,
    subagents: baseline.subagents,
    conversation,
  };
}
