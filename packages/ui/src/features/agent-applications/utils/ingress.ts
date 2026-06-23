import type { CloudRegion } from "@posthog/shared";

/**
 * Resolve the agent-ingress base URL for live (streaming) calls, derived per
 * region the same way the PostHog API base is (`getCloudUrlFromRegion`).
 *
 * In `dev` the backend hands out a trycloudflare quick-tunnel URL in
 * `ingress_base_url`, and those tunnels BUFFER SSE — so `/listen` never streams
 * incrementally through them. The local agent-ingress (localhost:3030) streams
 * fine, so for `dev` we keep the record's `/agents/<slug>` path but point the
 * origin at the local ingress. us/eu ingress URLs stream natively, so their
 * (region-correct) `ingress_base_url` is used as-is.
 */
const LOCAL_INGRESS_ORIGIN = "http://localhost:3030";

export function resolveIngressBaseUrl(
  ingressBaseUrl: string | null | undefined,
  region: CloudRegion | null,
): string | null {
  if (!ingressBaseUrl) return null;
  if (region === "dev") {
    return ingressBaseUrl.replace(/^https?:\/\/[^/]+/, LOCAL_INGRESS_ORIGIN);
  }
  return ingressBaseUrl;
}
