export interface GatewayModel {
  id: string;
  owned_by: string;
  context_window: number;
  supports_streaming: boolean;
  supports_vision: boolean;
  /**
   * Free-tier model gate (posthog_code): the gateway marks models the caller's
   * org can't use as `allowed: false` instead of omitting them, so pickers can
   * render them locked with an upgrade prompt. Only authenticated fetches get
   * marks — anonymous callers see everything allowed — and gateways predating
   * the gate omit the field, so absence means allowed.
   */
  allowed: boolean;
  restriction_reason?: string | null;
}

interface GatewayModelsResponse {
  object: "list";
  data: Array<Omit<GatewayModel, "allowed"> & { allowed?: boolean }>;
}

export interface FetchGatewayModelsOptions {
  gatewayUrl: string;
  /**
   * Bearer token for the models fetch. Required for accurate free-tier marks:
   * the gateway only annotates `allowed: false` for authenticated callers.
   */
  authToken?: string;
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

interface ModelsListEntry {
  id?: string;
  owned_by?: string;
  allowed?: boolean;
  restriction_reason?: string | null;
}

type ModelsListResponse =
  | {
      data?: ModelsListEntry[];
      models?: ModelsListEntry[];
    }
  | ModelsListEntry[];

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
  authed: boolean;
} | null = null;

function authHeaders(authToken?: string): Record<string, string> | undefined {
  return authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
}

export async function fetchGatewayModels(
  options?: FetchGatewayModelsOptions,
): Promise<GatewayModel[]> {
  const gatewayUrl = options?.gatewayUrl ?? process.env.ANTHROPIC_BASE_URL;
  if (!gatewayUrl) {
    return [];
  }

  // Authed and anonymous responses differ (free-tier marks are only present
  // on authed fetches), so a cached anonymous list must not serve an authed
  // caller or vice versa.
  const authed = Boolean(options?.authToken);
  if (
    gatewayModelsCache &&
    gatewayModelsCache.url === gatewayUrl &&
    gatewayModelsCache.authed === authed &&
    Date.now() < gatewayModelsCache.expiry
  ) {
    return gatewayModelsCache.models;
  }

  const modelsUrl = `${gatewayUrl}/v1/models`;

  try {
    const response = await fetch(modelsUrl, {
      headers: authHeaders(options?.authToken),
      signal: AbortSignal.timeout(GATEWAY_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as GatewayModelsResponse;
    const models = (data.data ?? [])
      .filter((m) => !isBlockedModelId(m.id))
      .map((m) => ({ ...m, allowed: m.allowed !== false }));
    gatewayModelsCache = {
      models,
      expiry: Date.now() + CACHE_TTL,
      url: gatewayUrl,
      authed,
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

// Cloudflare Workers AI model ids carry the `@cf/` path prefix (e.g. `@cf/zai-org/glm-5.2`). Kept as
// a standalone id-only check so callers that only have a model id (not a full GatewayModel) — like the
// Claude adapter's desync guard — share one source of truth with `isCloudflareModel`.
export function isCloudflareModelId(modelId: string): boolean {
  return modelId.startsWith("@cf/");
}

// Cloudflare Workers AI models (e.g. `@cf/zai-org/glm-5.2`). The gateway serves these over both its
// OpenAI and Anthropic-Messages surfaces (it translates the `@cf/` path), so the Claude adapter can
// drive them just like an Anthropic model. The `@cf/` path prefix is the structural, always-present
// signal, so honour it regardless of `owned_by` — a Cloudflare-served model can report an upstream
// owner (e.g. `@cf/openai/...` with `owned_by: "openai"`) and must still classify as Cloudflare.
export function isCloudflareModel(model: GatewayModel): boolean {
  return isCloudflareModelId(model.id) || model.owned_by === "cloudflare";
}

export interface ModelInfo {
  id: string;
  owned_by?: string;
  allowed: boolean;
  restriction_reason?: string | null;
}

let modelsListCache: {
  models: ModelInfo[];
  expiry: number;
  url: string;
  authed: boolean;
} | null = null;

export async function fetchModelsList(
  options?: FetchGatewayModelsOptions,
): Promise<ModelInfo[]> {
  const gatewayUrl = options?.gatewayUrl ?? process.env.ANTHROPIC_BASE_URL;
  if (!gatewayUrl) {
    return [];
  }

  const authed = Boolean(options?.authToken);
  if (
    modelsListCache &&
    modelsListCache.url === gatewayUrl &&
    modelsListCache.authed === authed &&
    Date.now() < modelsListCache.expiry
  ) {
    return modelsListCache.models;
  }

  try {
    const modelsUrl = `${gatewayUrl}/v1/models`;
    const response = await fetch(modelsUrl, {
      headers: authHeaders(options?.authToken),
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
      results.push({
        id,
        owned_by: model?.owned_by,
        allowed: model?.allowed !== false,
        restriction_reason: model?.restriction_reason ?? null,
      });
    }
    modelsListCache = {
      models: results,
      expiry: Date.now() + CACHE_TTL,
      url: gatewayUrl,
      authed,
    };
    return results;
  } catch {
    return [];
  }
}

/**
 * The model a session should start on: the preferred id when it's present and
 * allowed, else the newest allowed model (so a free-tier org lands on the
 * free model instead of a premium default that would 403 on first message).
 * Returns the preferred id unchanged when the list is empty (fetch failed —
 * no marks to honor) or nothing is allowed (all locked; the picker and the
 * upgrade gate communicate that state better than a silent second-guess).
 */
export function pickAllowedModel(
  models: ReadonlyArray<Pick<GatewayModel, "id" | "allowed">>,
  preferred: string,
): string {
  if (models.length === 0) return preferred;
  const preferredEntry = models.find((m) => m.id === preferred);
  if (!preferredEntry || preferredEntry.allowed) return preferred;
  const allowed = models.filter((m) => m.allowed);
  if (allowed.length === 0) return preferred;
  return allowed.reduce((best, candidate) =>
    getClaudeModelRecency(candidate.id) >= getClaudeModelRecency(best.id)
      ? candidate
      : best,
  ).id;
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
  if (isCloudflareModel(model)) {
    return (model.id.split("/").pop() ?? model.id).toLowerCase();
  }

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
