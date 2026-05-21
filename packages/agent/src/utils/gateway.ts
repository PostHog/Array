export type GatewayProduct = "posthog_code" | "background_agents" | "signals";

const SIGNAL_REPORT_ORIGIN_PRODUCT = "signal_report";

export function resolveGatewayProduct({
  isInternal,
  originProduct,
}: {
  isInternal?: boolean;
  originProduct?: string | null;
} = {}): GatewayProduct {
  if (isInternal) {
    return originProduct === SIGNAL_REPORT_ORIGIN_PRODUCT
      ? "signals"
      : "background_agents";
  }
  return "posthog_code";
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
