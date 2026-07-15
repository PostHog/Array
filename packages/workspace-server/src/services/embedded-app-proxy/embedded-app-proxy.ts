import http from "node:http";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { serializeError } from "@posthog/shared";
import { inject, injectable } from "inversify";
import {
  type StreamProgress,
  streamBodyToResponse,
} from "../proxy-stream/proxy-stream";
import type { EmbeddedAppProxyAuth } from "./identifiers";
import { EMBEDDED_APP_PROXY_AUTH } from "./identifiers";

export interface EmbeddedAppProxyOptions {
  /** PostHog cloud origin, e.g. https://us.posthog.com */
  upstreamUrl: string;
  /**
   * Where the webapp's JS/CSS come from. During the experiment this is the
   * posthog repo's vite dev server (e.g. http://localhost:8135); production
   * packaging would serve a built `dist/` from here instead.
   */
  assetsUrl: string;
  /** Fixed port for dev harnesses; defaults to an OS-assigned port. */
  port?: number;
}

/**
 * EXPERIMENT (embedded webapp): local same-origin server for the PostHog
 * webapp running inside an iframe of the desktop app.
 *
 * Modeled on AuthProxyService. Two jobs:
 *  1. Serve a minimal HTML shell (history-API fallback for every non-API GET)
 *     that boots the webapp's `embed` vite entry.
 *  2. Proxy backend paths (/api, /_preflight, ...) to PostHog cloud, stripping
 *     browser credentials and injecting a fresh OAuth Bearer token via the
 *     host-supplied authenticatedFetch. The iframe therefore sees a plain
 *     same-origin session-style API and no CORS is involved.
 */
@injectable()
export class EmbeddedAppProxyService {
  private server: http.Server | null = null;
  private options: EmbeddedAppProxyOptions | null = null;
  private port: number | null = null;
  private readonly log: ScopedLogger;

  constructor(
    @inject(EMBEDDED_APP_PROXY_AUTH)
    private readonly auth: EmbeddedAppProxyAuth,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("embedded-app-proxy");
  }

  /** Path prefixes forwarded to PostHog cloud; everything else is the shell. */
  private static readonly UPSTREAM_PREFIXES = [
    "/api/",
    "/_preflight",
    "/uploaded_media/",
    "/media/",
    "/static/",
  ];

  /**
   * Idempotent start with host-derived defaults; used by the host router.
   * Assets come from the posthog repo's vite dev server during the experiment
   * (override with POSTHOG_EMBED_ASSETS_URL).
   */
  async ensureStarted(): Promise<string> {
    if (this.isRunning()) {
      return this.getProxyUrl();
    }
    const upstreamUrl = await this.auth.getUpstreamUrl();
    const assetsUrl =
      process.env.POSTHOG_EMBED_ASSETS_URL ?? "http://localhost:8135";
    return this.start({ upstreamUrl, assetsUrl });
  }

  async start(options: EmbeddedAppProxyOptions): Promise<string> {
    if (this.server) {
      this.options = options;
      return this.getProxyUrl();
    }
    this.options = options;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise<string>((resolve, reject) => {
      this.server?.listen(options.port ?? 0, "127.0.0.1", () => {
        const addr = this.server?.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
          this.log.info("Embedded app proxy started", {
            url: this.getProxyUrl(),
            upstream: options.upstreamUrl,
            assets: options.assetsUrl,
          });
          resolve(this.getProxyUrl());
        } else {
          reject(new Error("Failed to get embedded app proxy address"));
        }
      });
      this.server?.on("error", (err) => {
        this.log.error("Embedded app proxy server error", err);
        reject(err);
      });
    });
  }

  getProxyUrl(): string {
    if (!this.port) {
      throw new Error("Embedded app proxy not started");
    }
    return `http://127.0.0.1:${this.port}`;
  }

  isRunning(): boolean {
    return this.server !== null && this.port !== null;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise<void>((resolve) => {
      this.server?.close(() => {
        this.log.info("Embedded app proxy stopped");
        this.server = null;
        this.port = null;
        resolve();
      });
    });
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const options = this.options;
    if (!options) {
      res.writeHead(503);
      res.end("Proxy not configured");
      return;
    }

    const pathname = (req.url ?? "/").split("?")[0] ?? "/";
    const isUpstream = EmbeddedAppProxyService.UPSTREAM_PREFIXES.some(
      (prefix) =>
        pathname.startsWith(prefix) ||
        pathname === prefix.replace(/\/$/, "") ||
        `${pathname}/` === prefix,
    );

    if (!isUpstream) {
      if (req.method === "GET" || req.method === "HEAD") {
        const html = this.buildShellHtml(options);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(req.method === "HEAD" ? undefined : html);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    const base = options.upstreamUrl.endsWith("/")
      ? options.upstreamUrl
      : `${options.upstreamUrl}/`;
    const incoming = (req.url ?? "/").replace(/^\//, "");
    const targetUrl = new URL(incoming, base);

    const upstreamBase = new URL(base);
    const sameOrigin =
      targetUrl.protocol === upstreamBase.protocol &&
      targetUrl.host === upstreamBase.host;
    if (!sameOrigin || targetUrl.pathname.includes("..")) {
      this.log.warn("Rejected embedded app proxy request", {
        method: req.method,
        incoming: req.url,
      });
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // Strip anything credential-shaped or origin-revealing: the upstream
    // request is authenticated solely by the injected Bearer token, and
    // cookies/origin/referer from the local shell would confuse Django's
    // session/CSRF machinery.
    const strippedHeaders = new Set([
      "host",
      "connection",
      "cookie",
      "origin",
      "referer",
      "authorization",
      "x-api-key",
      "api-key",
      "proxy-authorization",
      "accept-encoding",
      "x-csrftoken",
    ]);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (strippedHeaders.has(key)) continue;
      if (typeof value === "string") headers[key] = value;
    }

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        abort.abort();
      }
    });

    const fetchOptions: RequestInit = {
      method: req.method ?? "GET",
      headers,
      signal: abort.signal,
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        fetchOptions.body = Buffer.concat(chunks);
        void this.forwardRequest(targetUrl.toString(), fetchOptions, res);
      });
    } else {
      void this.forwardRequest(targetUrl.toString(), fetchOptions, res);
    }
  }

  private buildShellHtml(options: EmbeddedAppProxyOptions): string {
    const assets = options.assetsUrl.replace(/\/$/, "");
    // Dev-server variant: load the embed entry straight from vite, with the
    // react-refresh preamble vite's Django template would normally inject.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PostHog (embedded)</title>
<script>
  window.JS_URL = ${JSON.stringify(assets)};
  window.__POSTHOG_EMBED__ = true;
</script>
<script type="module">
  import RefreshRuntime from ${JSON.stringify(`${assets}/@react-refresh`)};
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
  window.__vite_plugin_react_preamble_installed__ = true;
</script>
<script type="module" src="${assets}/@vite/client"></script>
<script type="module" src="${assets}/src/embed/index.tsx"></script>
</head>
<body>
<div id="root"></div>
</body>
</html>`;
  }

  private async forwardRequest(
    url: string,
    options: RequestInit,
    res: http.ServerResponse,
  ): Promise<void> {
    const startedAt = Date.now();
    const progress: StreamProgress = { bytesWritten: 0 };
    let status = 0;
    try {
      const response = await this.auth.authenticatedFetch(url, options);
      status = response.status;

      const stripHeaders = new Set([
        "transfer-encoding",
        "content-encoding",
        "content-length",
        "set-cookie",
        "content-security-policy",
        "x-frame-options",
      ]);
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value: string, key: string) => {
        if (stripHeaders.has(key)) return;
        responseHeaders[key] = value;
      });

      res.writeHead(response.status, responseHeaders);
      await streamBodyToResponse(response.body, res, progress);

      if (status >= 400) {
        this.log.warn("Embedded app proxy upstream error", {
          url,
          method: options.method,
          status,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (err) {
      if (options.signal?.aborted) {
        this.log.debug("Upstream fetch aborted after client disconnect", {
          url,
        });
      } else {
        this.log.error("Embedded app proxy forward error", {
          url,
          method: options.method,
          status,
          durationMs: Date.now() - startedAt,
          errorDetail: serializeError(err),
        });
      }
      if (!res.headersSent) {
        res.writeHead(502);
      }
      res.end("Proxy error");
    }
  }
}
