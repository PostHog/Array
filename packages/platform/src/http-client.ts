/**
 * Host HTTP client port.
 *
 * Lets host-agnostic services make HTTP requests through the host's network
 * stack instead of the ambient global `fetch`.
 *
 * Why this matters: in the Electron host these requests run in the main
 * process, where the global `fetch` is Node's undici. undici ignores the
 * system proxy and certificate configuration that Chromium honours, so a
 * request that succeeds from the renderer can fail in the main process with
 * a bare "fetch failed" on machines behind a proxy or with a custom trust
 * store. The Electron adapter backs this port with `net.fetch` (Chromium's
 * networking) to match the renderer's behaviour.
 */
export interface IHttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export const HTTP_CLIENT_SERVICE = Symbol.for("posthog.platform.httpClient");
