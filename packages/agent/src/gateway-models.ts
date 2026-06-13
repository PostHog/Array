export interface GatewayModel {
  id: string;
  owned_by: string;
  context_window: number;
  supports_streaming: boolean;
  supports_vision: boolean;
}

interface GatewayModelsResponse {
  object: "list";
  data: GatewayModel[];
}

export interface FetchGatewayModelsOptions {
  gatewayUrl: string;
}

export const DEFAULT_GATEWAY_MODEL = "claude-opus-4-8";

export const DEFAULT_CODEX_MODEL = "gpt-5.5";

const BLOCKED_MODELS = new Set([
  "gpt-5-mini",
  "openai/gpt-5-mini",
  "gpt-5.2",
  "openai/gpt-5.2",
  "gpt-5.3",
  "openai/gpt-5.3",
  "gpt-5.3-codex",
  "openai/gpt-5.3-codex",
  "claude-opus-4-5",
  "anthropic/claude-opus-4-5",
  "claude-opus-4-6",
  "anthropic/claude-opus-4-6",
  "claude-sonnet-4-5",
  "anthropic/claude-sonnet-4-5",
  "claude-haiku-4-5",
  "anthropic/claude-haiku-4-5",
]);

export function isBlockedModelId(modelId: string): boolean {
  return BLOCKED_MODELS.has(modelId.toLowerCase());
}

type ModelsListResponse =
  | {
      data?: Array<{ id?: string; owned_by?: string }>;
      models?: Array<{ id?: string; owned_by?: string }>;
    }
  | Array<{ id?: string; owned_by?: string }>;

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Bound the gateway /v1/models request so a stalled connection cannot hold up
// session init: this fetch runs inside the Promise.all that gates the 30s SDK
// initialization timeout, so it must resolve well within that window. On abort
// the callers fall through to `return []`.
const GATEWAY_FETCH_TIMEOUT_MS = 10_000;

let gatewayModelsCache: {
  models: GatewayModel[];
  expiry: number;
  url: string;
} | null = null;

export async function fetchGatewayModels(
  options?: FetchGatewayModelsOptions,
): Promise<GatewayModel[]> {
  const gatewayUrl = options?.gatewayUrl ?? process.env.ANTHROPIC_BASE_URL;
  if (!gatewayUrl) {
    return [];
  }

  if (
    gatewayModelsCache &&
    gatewayModelsCache.url === gatewayUrl &&
    Date.now() < gatewayModelsCache.expiry
  ) {
    return gatewayModelsCache.models;
  }

  const modelsUrl = `${gatewayUrl}/v1/models`;

  try {
    const response = await fetch(modelsUrl, {
      signal: AbortSignal.timeout(GATEWAY_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as GatewayModelsResponse;
    const models = (data.data ?? []).filter((m) => !isBlockedModelId(m.id));
    gatewayModelsCache = {
      models,
      expiry: Date.now() + CACHE_TTL,
      url: gatewayUrl,
    };
    return models;
  } catch {
    return [];
  }
}

export function isAnthropicModel(model: GatewayModel): boolean {
  if (model.owned_by) {
    return model.owned_by === "anthropic";
  }
  return model.id.startsWith("claude-") || model.id.startsWith("anthropic/");
}

export function isOpenAIModel(model: GatewayModel): boolean {
  if (model.owned_by) {
    return model.owned_by === "openai";
  }
  return model.id.startsWith("gpt-") || model.id.startsWith("openai/");
}

export interface ModelInfo {
  id: string;
  owned_by?: string;
}

let modelsListCache: {
  models: ModelInfo[];
  expiry: number;
  url: string;
} | null = null;

export async function fetchModelsList(
  options?: FetchGatewayModelsOptions,
): Promise<ModelInfo[]> {
  const gatewayUrl = options?.gatewayUrl ?? process.env.ANTHROPIC_BASE_URL;
  if (!gatewayUrl) {
    return [];
  }

  if (
    modelsListCache &&
    modelsListCache.url === gatewayUrl &&
    Date.now() < modelsListCache.expiry
  ) {
    return modelsListCache.models;
  }

  try {
    const modelsUrl = `${gatewayUrl}/v1/models`;
    const response = await fetch(modelsUrl, {
      signal: AbortSignal.timeout(GATEWAY_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as ModelsListResponse;
    const models = Array.isArray(data)
      ? data
      : (data.data ?? data.models ?? []);
    const results: ModelInfo[] = [];
    for (const model of models) {
      const id = model?.id ? String(model.id) : "";
      if (!id) continue;
      if (isBlockedModelId(id)) continue;
      results.push({ id, owned_by: model?.owned_by });
    }
    modelsListCache = {
      models: results,
      expiry: Date.now() + CACHE_TTL,
      url: gatewayUrl,
    };
    return results;
  } catch {
    return [];
  }
}

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "google-vertex": "Gemini",
};

export function getProviderName(ownedBy: string): string {
  return PROVIDER_NAMES[ownedBy] ?? ownedBy;
}

// Sort key for ordering models oldest-to-newest in pickers. The model menu
// opens upward (side="top"), so the last item sits closest to the trigger —
// sorting ascending by this key puts the newest model right under the user's
// cursor. The key is the version embedded in the model id, e.g.
// "claude-sonnet-4-6" -> 4006, "claude-opus-4-8" -> 4008, "claude-fable-5" ->
// 5000; a higher number means a newer model. An id with no recognisable
// version (a brand-new or unexpected release) ranks as newest so it still
// surfaces at the end rather than at an arbitrary gateway-determined position.
// Only the first version group is read, so a trailing date suffix (e.g.
// "-20251001") is ignored; the minor component is assumed to be < 1000.
export function getClaudeModelRecency(modelId: string): number {
  const match = modelId.toLowerCase().match(/-(\d+)(?:[-.](\d+))?/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const major = Number(match[1]);
  const minor = match[2] ? Number(match[2]) : 0;
  return major * 1000 + minor;
}

const PROVIDER_PREFIXES = ["anthropic/", "openai/", "google-vertex/"];

export function formatGatewayModelName(model: GatewayModel): string {
  if (isOpenAIModel(model)) {
    return stripProviderPrefix(model.id).toLowerCase();
  }

  return formatModelId(model.id);
}

function stripProviderPrefix(modelId: string): string {
  for (const prefix of PROVIDER_PREFIXES) {
    if (modelId.startsWith(prefix)) {
      return modelId.slice(prefix.length);
    }
  }
  return modelId;
}

export function formatModelId(modelId: string): string {
  let cleanId = modelId;
  for (const prefix of PROVIDER_PREFIXES) {
    if (cleanId.startsWith(prefix)) {
      cleanId = cleanId.slice(prefix.length);
      break;
    }
  }

  cleanId = cleanId.replace(/(\d)-(\d)/g, "$1.$2");

  const words = cleanId.split(/[-_]/).map((word) => {
    if (word.match(/^[0-9.]+$/)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });

  return words.join(" ");
}
