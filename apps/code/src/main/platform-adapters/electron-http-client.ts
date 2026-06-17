import type { IHttpClient } from "@posthog/platform/http-client";
import { net } from "electron";
import { injectable } from "inversify";

/**
 * Backs the HTTP client port with Electron's `net.fetch`, which uses Chromium's
 * networking rather than Node's undici. Chromium honours the system proxy and
 * certificate configuration, so main-process requests behave like the
 * renderer's. Without this, OAuth token exchange fails with "fetch failed" on
 * machines behind a proxy or with a custom trust store even when the renderer's
 * API calls succeed.
 */
@injectable()
export class ElectronHttpClient implements IHttpClient {
  public fetch(url: string, init?: RequestInit): Promise<Response> {
    return net.fetch(url, init);
  }
}
