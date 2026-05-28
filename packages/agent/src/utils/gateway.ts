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
  if (isInternal) {
    return originProduct === "signal_report" ? "signals" : "background_agents";
  }
  return "posthog_code";
}

/**
 * Build `x-posthog-property-<name>: <value>` header lines that the LLM
 * gateway lifts onto the `$ai_generation` event it captures for each call
 * (see `services/llm-gateway/src/llm_gateway/request_context.py`).
 *
 * Returns a newline-joined string ready for `ANTHROPIC_CUSTOM_HEADERS`.
 * `null`/`undefined` property values are dropped.
 */
export function buildGatewayPropertyHeaders(
  properties: Record<string, string | number | boolean | null | undefined>,
): string {
  return Object.entries(properties)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `x-posthog-property-${key}: ${value}`)
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

  const region = hostname.match(/^(us|eu)\.posthog\.com$/)?.[1] ?? "us";
  return `https://gateway.${region}.posthog.com`;
}

export function getLlmGatewayUrl(
  posthogHost: string,
  product: GatewayProduct = "posthog_code",
): string {
  return `${getGatewayBaseUrl(posthogHost)}/${product}`;
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
