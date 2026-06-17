export type GatewayProduct =
  | "posthog_code"
  | "background_agents"
  | "signals"
  | "slack_app";

export function resolveGatewayProduct({
  isInternal,
  originProduct,
}: {
  isInternal?: boolean;
  originProduct?: string | null;
} = {}): GatewayProduct {
  if (originProduct === "slack") {
    return "slack_app";
  }
  if (originProduct === "signal_report" || originProduct === "signals_scout") {
    return "signals";
  }
  if (isInternal) {
    return "background_agents";
  }
  return "posthog_code";
}

/**
 * Make a value safe to embed in an HTTP header value. Collapses newlines to
 * spaces (the header block is newline-delimited) and drops characters outside
 * the valid header-byte range — control chars and code points above latin1
 * (emoji, smart quotes) — which an HTTP client (e.g. undici) would otherwise
 * reject before sending. ASCII is preserved.
 */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[^\x20-\x7e\x80-\xff]/g, "");
}

/**
 * Build `x-posthog-property-<name>: <value>` header lines that the LLM
 * gateway lifts onto the `$ai_generation` event it captures for each call
 * (see `services/llm-gateway/src/llm_gateway/request_context.py`).
 *
 * Returns a newline-joined string ready for `ANTHROPIC_CUSTOM_HEADERS`.
 * `null`/`undefined` values are dropped; values are sanitized to be HTTP-header
 * safe (see {@link sanitizeHeaderValue}).
 */
export function buildGatewayPropertyHeaders(
  properties: Record<string, string | number | boolean | null | undefined>,
): string {
  return Object.entries(properties)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(
      ([key, value]) =>
        `x-posthog-property-${key}: ${sanitizeHeaderValue(String(value))}`,
    )
    .join("\n");
}

function getGatewayBaseUrl(posthogHost: string): string {
  const url = new URL(posthogHost);
  const hostname = url.hostname;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${url.protocol}//localhost:3308`;
  }

  if (hostname === "host.docker.internal") {
    return `${url.protocol}//host.docker.internal:3308`;
  }

  // The hosted dev environment runs its own LLM gateway with its own auth DB,
  // so a dev-minted `pha_` token can't be routed to the US gateway — that's
  // a different DB and returns 401 Authentication required.
  if (hostname === "app.dev.posthog.dev") {
    return "https://gateway.dev.posthog.dev";
  }

  const region = hostname.match(/^(us|eu)\.posthog\.com$/)?.[1] ?? "us";
  return `https://gateway.${region}.posthog.com`;
}

export function getLlmGatewayUrl(
  posthogHost: string,
  product: GatewayProduct = "posthog_code",
): string {
  return `${getGatewayBaseUrl(posthogHost)}/${product}`;
}

/**
 * Resolve the gateway URL for a request, preferring an explicit
 * `LLM_GATEWAY_URL` override over the region-aware default. The override is
 * treated as a *base* URL — the product slug is always appended so the gateway
 * can route to the correct product config. Without this, a bare-host override
 * (e.g. `https://gateway.dev.posthog.dev`) lost the product suffix and every
 * request fell into the catch-all `llm_gateway` product which OAuth tokens
 * cannot use (403).
 */
export function resolveLlmGatewayUrl(
  envUrl: string | undefined,
  posthogHost: string,
  product: GatewayProduct = "posthog_code",
): string {
  if (envUrl) {
    return `${envUrl.replace(/\/$/, "")}/${product}`;
  }
  return getLlmGatewayUrl(posthogHost, product);
}

export function getGatewayUsageUrl(
  posthogHost: string,
  product: GatewayProduct = "posthog_code",
): string {
  return `${getGatewayBaseUrl(posthogHost)}/v1/usage/${product}`;
}

export function getGatewayInvalidatePlanCacheUrl(
  posthogHost: string,
  product: GatewayProduct = "posthog_code",
): string {
  return `${getGatewayBaseUrl(posthogHost)}/v1/usage/${product}/invalidate-plan-cache`;
}
