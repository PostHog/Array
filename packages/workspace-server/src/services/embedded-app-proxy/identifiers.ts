export const EMBEDDED_APP_PROXY_SERVICE = Symbol.for(
  "posthog.workspace.embeddedAppProxyService",
);
export const EMBEDDED_APP_PROXY_AUTH = Symbol.for(
  "posthog.workspace.embeddedAppProxyAuth",
);

/** Token-injecting fetch supplied by the host (main process AuthService). */
export interface EmbeddedAppProxyAuth {
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
  /** Cloud origin for the signed-in region, e.g. https://us.posthog.com */
  getUpstreamUrl(): Promise<string>;
}
