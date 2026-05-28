export const DEFAULT_MODEL = "opus";

const GATEWAY_TO_SDK_MODEL: Record<string, string> = {
  "claude-opus-4-5": "opus",
  "claude-opus-4-6": "opus",
  "claude-opus-4-7": "opus",
  "claude-opus-4-8": "opus",
  "claude-sonnet-4-5": "sonnet",
  "claude-sonnet-4-6": "sonnet",
  "claude-haiku-4-5": "haiku",
};

export function toSdkModelId(modelId: string): string {
  return GATEWAY_TO_SDK_MODEL[modelId] ?? modelId;
}

const MODELS_WITH_1M_CONTEXT = new Set([
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
]);

export function supports1MContext(modelId: string): boolean {
  return MODELS_WITH_1M_CONTEXT.has(modelId);
}

const MODELS_WITH_EFFORT = new Set([
  "claude-opus-4-5",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
]);

const MODELS_WITH_XHIGH_EFFORT = new Set([
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
]);

export function supportsEffort(modelId: string): boolean {
  return MODELS_WITH_EFFORT.has(modelId);
}

export function supportsXhighEffort(modelId: string): boolean {
  return MODELS_WITH_XHIGH_EFFORT.has(modelId);
}

const MODELS_TO_EXCLUDE_MCP_TOOLS = new Set(["claude-haiku-4-5"]);

export function supportsMcpInjection(modelId: string): boolean {
  return !MODELS_TO_EXCLUDE_MCP_TOOLS.has(modelId);
}

interface EffortOption {
  value: string;
  name: string;
}

export function getEffortOptions(modelId: string): EffortOption[] | null {
  if (!supportsEffort(modelId)) return null;

  const options: EffortOption[] = [
    { value: "low", name: "Low" },
    { value: "medium", name: "Medium" },
    { value: "high", name: "High" },
  ];

  if (supportsXhighEffort(modelId)) {
    options.push(
      { value: "xhigh", name: "Extra High" },
      { value: "max", name: "Max" },
    );
  }

  return options;
}

// Model alias resolution — lets callers use human-friendly aliases like
// "opus" or "sonnet" instead of full model IDs like "claude-opus-4-6".

const MODEL_CONTEXT_HINT_PATTERN = /\[(\d+m)\]$/i;

function tokenizeModelPreference(model: string): {
  tokens: string[];
  contextHint?: string;
} {
  const lower = model.trim().toLowerCase();
  const contextHint = lower
    .match(MODEL_CONTEXT_HINT_PATTERN)?.[1]
    ?.toLowerCase();

  const normalized = lower.replace(MODEL_CONTEXT_HINT_PATTERN, " $1 ");
  const rawTokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const tokens = rawTokens
    .map((token) => {
      if (token === "opusplan") return "opus";
      if (token === "best" || token === "default") return "";
      return token;
    })
    .filter((token) => token && token !== "claude")
    .filter((token) => /[a-z]/.test(token) || token.endsWith("m"));

  return { tokens, contextHint };
}

interface ModelOption {
  value: string;
  name?: string;
  description?: string;
}

// Captures a model family version such as `4-6` or `4.7` so we can keep
// `claude-opus-4-6` from being copied onto the SDK's `opus` alias when that
// alias currently resolves to a different family version (e.g. Opus 4.7).
const MODEL_FAMILY_VERSION_PATTERN = /\b(\d+)[-.](\d+)\b/;

function extractModelFamilyVersion(s: string | undefined): string | null {
  if (!s) return null;
  const match = s.match(MODEL_FAMILY_VERSION_PATTERN);
  return match ? `${match[1]}.${match[2]}` : null;
}

function modelVersionsCompatible(
  preference: string,
  candidate: ModelOption,
): boolean {
  const preferred = extractModelFamilyVersion(preference);
  if (!preferred) return true;
  const candidateVersion =
    extractModelFamilyVersion(candidate.value) ??
    extractModelFamilyVersion(candidate.name) ??
    extractModelFamilyVersion(candidate.description);
  if (!candidateVersion) return true;
  return preferred === candidateVersion;
}

function scoreModelMatch(
  model: ModelOption,
  tokens: string[],
  contextHint?: string,
): number {
  const haystack = `${model.value} ${model.name ?? ""}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += token === contextHint ? 3 : 1;
    }
  }
  return score;
}

export function resolveModelPreference(
  preference: string,
  options: ModelOption[],
): string | null {
  const trimmed = preference.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  // Exact match on value or display name
  const directMatch = options.find(
    (o) =>
      o.value === trimmed ||
      o.value.toLowerCase() === lower ||
      (o.name && o.name.toLowerCase() === lower),
  );
  if (directMatch) return directMatch.value;

  // Substring match
  const includesMatch = options.find((o) => {
    if (!modelVersionsCompatible(trimmed, o)) return false;
    const value = o.value.toLowerCase();
    const display = (o.name ?? "").toLowerCase();
    return (
      value.includes(lower) || display.includes(lower) || lower.includes(value)
    );
  });
  if (includesMatch) return includesMatch.value;

  // Tokenized matching for aliases like "opus[1m]"
  const { tokens, contextHint } = tokenizeModelPreference(trimmed);
  if (tokens.length === 0) return null;

  let bestMatch: ModelOption | null = null;
  let bestScore = 0;
  for (const model of options) {
    if (!modelVersionsCompatible(trimmed, model)) continue;
    const score = scoreModelMatch(model, tokens, contextHint);
    if (0 < score && (!bestMatch || bestScore < score)) {
      bestMatch = model;
      bestScore = score;
    }
  }

  return bestMatch?.value ?? null;
}
