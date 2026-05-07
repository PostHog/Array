import http from "node:http";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { AuthService } from "../auth/service";

const log = logger.scope("auth-proxy");

@injectable()
export class AuthProxyService {
  private server: http.Server | null = null;
  private gatewayUrl: string | null = null;
  private port: number | null = null;

  constructor(
    @inject(MAIN_TOKENS.AuthService)
    private readonly authService: AuthService,
  ) {}

  async start(gatewayUrl: string): Promise<string> {
    if (this.server) {
      this.gatewayUrl = gatewayUrl;
      return this.getProxyUrl();
    }

    this.gatewayUrl = gatewayUrl;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise<string>((resolve, reject) => {
      this.server?.listen(0, "127.0.0.1", () => {
        const addr = this.server?.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
          resolve(this.getProxyUrl());
        } else {
          reject(new Error("Failed to get proxy address"));
        }
      });

      this.server?.on("error", (err) => {
        log.error("Auth proxy server error", err);
        reject(err);
      });
    });
  }

  getProxyUrl(): string {
    if (!this.port) {
      throw new Error("Auth proxy not started");
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
        log.info("Auth proxy stopped");
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
    if (!this.gatewayUrl) {
      res.writeHead(503);
      res.end("Proxy not configured");
      return;
    }

    const base = this.gatewayUrl.endsWith("/")
      ? this.gatewayUrl
      : `${this.gatewayUrl}/`;
    const incoming = (req.url ?? "/").replace(/^\//, "");
    const targetUrl = new URL(incoming, base);

    // Validate that the resolved URL stays within the configured gateway origin
    const gatewayBase = new URL(base);
    const normalizePort = (u: URL): string => {
      if (u.port) return u.port;
      if (u.protocol === "https:") return "443";
      if (u.protocol === "http:") return "80";
      return "";
    };

    const targetPort = normalizePort(targetUrl);
    const gatewayPort = normalizePort(gatewayBase);

    const sameOrigin =
      targetUrl.protocol === gatewayBase.protocol &&
      targetUrl.hostname === gatewayBase.hostname &&
      targetPort === gatewayPort;

    const hasPathTraversal = targetUrl.pathname.includes("..");

    if (!sameOrigin || hasPathTraversal) {
      log.warn("Rejected proxy request with invalid target URL", {
        method: req.method,
        incoming: req.url,
        target: targetUrl.toString(),
      });
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const strippedAuthHeaders = new Set([
      "authorization",
      "x-api-key",
      "api-key",
      "anthropic-auth-token",
      "proxy-authorization",
    ]);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (
        key === "host" ||
        key === "connection" ||
        strippedAuthHeaders.has(key)
      ) {
        continue;
      }
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
    const fetchOptions: RequestInit = {
      method: req.method ?? "GET",
      headers,
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        fetchOptions.body = Buffer.concat(chunks);
        this.forwardRequest(targetUrl.toString(), fetchOptions, res);
      });
    } else {
      this.forwardRequest(targetUrl.toString(), fetchOptions, res);
    }
  }

  private async forwardRequest(
    url: string,
    options: RequestInit,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const response = await this.authService.authenticatedFetch(
        fetch,
        url,
        options,
      );

      const responseHeaders: Record<string, string> = {};
      const stripHeaders = new Set([
        "transfer-encoding",
        "content-encoding",
        "content-length",
      ]);
      response.headers.forEach((value: string, key: string) => {
        if (stripHeaders.has(key)) return;
        responseHeaders[key] = value;
      });

      res.writeHead(response.status, responseHeaders);

      if (!response.body) {
        res.end();
        return;
      }

      const reader = response.body.getReader();
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        const canContinue = res.write(value);
        if (canContinue) {
          return pump();
        }
        res.once("drain", () => pump());
      };

      await pump();
    } catch (err) {
      log.error("Proxy forward error", { url, err });
      if (!res.headersSent) {
        res.writeHead(502);
      }
      res.end("Proxy error");
    }
  }
}
