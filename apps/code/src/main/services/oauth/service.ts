import * as crypto from "node:crypto";
import * as http from "node:http";
import type { Socket } from "node:net";
import type { IMainWindow } from "@posthog/platform/main-window";
import type { IUrlLauncher } from "@posthog/platform/url-launcher";
import {
  getOauthClientIdFromRegion,
  OAUTH_SCOPES,
} from "@shared/constants/oauth";
import { type BackoffOptions, sleepWithBackoff } from "@shared/utils/backoff";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { isDevBuild } from "../../utils/env";
import { logger } from "../../utils/logger";
import type { DeepLinkService } from "../deep-link/service";
import type {
  CancelFlowOutput,
  CloudRegion,
  OAuthTokenResponse,
  RefreshTokenOutput,
  StartFlowOutput,
} from "./schemas";

const log = logger.scope("oauth-service");

const OAUTH_TIMEOUT_MS = 180_000; // 3 minutes
const DEV_CALLBACK_PORT = 8237;

const NETWORK_ERROR_MESSAGE =
  "Could not connect to PostHog. Please check your internet connection and try again.";

const TOKEN_FETCH_MAX_ATTEMPTS = 3;
const TOKEN_FETCH_BACKOFF: BackoffOptions = {
  initialDelayMs: 1_000,
  maxDelayMs: 5_000,
  multiplier: 2,
};

interface OAuthConfig {
  scopes: string[];
  cloudRegion: CloudRegion;
}

interface PendingOAuthFlow {
  codeVerifier: string;
  config: OAuthConfig;
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  server?: http.Server;
  connections?: Set<Socket>;
}

@injectable()
export class OAuthService {
  private pendingFlow: PendingOAuthFlow | null = null;

  constructor(
    @inject(MAIN_TOKENS.DeepLinkService)
    private readonly deepLinkService: DeepLinkService,
    @inject(MAIN_TOKENS.UrlLauncher)
    private readonly urlLauncher: IUrlLauncher,
    @inject(MAIN_TOKENS.MainWindow)
    private readonly mainWindow: IMainWindow,
  ) {
    // Register OAuth callback handler for deep links
    this.deepLinkService.registerHandler("callback", (_path, searchParams) =>
      this.handleOAuthCallback(searchParams),
    );
  }

  private handleOAuthCallback(searchParams: URLSearchParams): boolean {
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (!this.pendingFlow) {
      // Same deep link as desktop sign-in (`posthog-code://callback`), but auth finished in
      // the browser (e.g. GitHub on PostHog Cloud) — refocus so the user lands back in Code.
      log.info(
        "OAuth callback deep link with no in-app flow — refocusing (e.g. return from web auth)",
      );
      log.info("oauth callback deep link (no in-app flow) — focusing window");
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.focus();
      return true;
    }

    const { resolve, reject, timeoutId } = this.pendingFlow;
    clearTimeout(timeoutId);
    this.pendingFlow = null;

    if (error) {
      reject(new Error(`OAuth error: ${error}`));
      return true;
    }

    if (code) {
      resolve(code);
      return true;
    }

    reject(new Error("OAuth callback missing code"));
    return true;
  }

  /**
   * Get the redirect URI based on environment.
   */
  private getRedirectUri(): string {
    return isDevBuild()
      ? `http://localhost:${DEV_CALLBACK_PORT}/callback`
      : `${this.deepLinkService.getProtocol()}://callback`;
  }

  /**
   * Start the OAuth flow.
   * Uses HTTP callback in development, deep links in production.
   */
  public async startFlow(region: CloudRegion): Promise<StartFlowOutput> {
    try {
      // Cancel any existing flow
      this.cancelFlow();

      const config: OAuthConfig = {
        scopes: OAUTH_SCOPES,
        cloudRegion: region,
      };

      const codeVerifier = this.generateCodeVerifier();
      const authUrl = this.buildAuthorizeUrl(region, codeVerifier);

      return await this.startFlowWithUrl(
        config,
        codeVerifier,
        authUrl.toString(),
      );
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Start the OAuth flow from the signup page.
   */
  public async startSignupFlow(region: CloudRegion): Promise<StartFlowOutput> {
    try {
      // Cancel any existing flow
      this.cancelFlow();

      const config: OAuthConfig = {
        scopes: OAUTH_SCOPES,
        cloudRegion: region,
      };

      const codeVerifier = this.generateCodeVerifier();
      const authUrl = this.buildAuthorizeUrl(region, codeVerifier);
      const signupUrl = this.buildSignupUrl(region, authUrl);

      return await this.startFlowWithUrl(
        config,
        codeVerifier,
        signupUrl.toString(),
      );
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Refresh an access token using a refresh token.
   */
  public async refreshToken(
    refreshToken: string,
    region: CloudRegion,
  ): Promise<RefreshTokenOutput> {
    try {
      const cloudUrl = getCloudUrlFromRegion(region);

      const response = await fetch(`${cloudUrl}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: getOauthClientIdFromRegion(region),
        }),
      });

      if (!response.ok) {
        // 401/403 are auth errors - the token is invalid
        const isAuthError = response.status === 401 || response.status === 403;
        // 5xx are server errors - should be retried
        const isServerError = response.status >= 500;
        log.warn(
          `Token refresh failed: ${response.status} ${response.statusText}`,
        );
        return {
          success: false,
          error: `Token refresh failed: ${response.status} ${response.statusText}`,
          errorCode: isAuthError
            ? "auth_error"
            : isServerError
              ? "server_error"
              : "unknown_error",
        };
      }

      const tokenResponse: OAuthTokenResponse = await response.json();

      return {
        success: true,
        data: tokenResponse,
      };
    } catch {
      return {
        success: false,
        error: NETWORK_ERROR_MESSAGE,
        errorCode: "network_error",
      };
    }
  }

  /**
   * Cancel any pending OAuth flow.
   */
  public cancelFlow(): CancelFlowOutput {
    try {
      if (this.pendingFlow) {
        // Clean up HTTP server if in dev mode
        if (this.pendingFlow.server) {
          this.cleanupHttpServer();
        } else {
          clearTimeout(this.pendingFlow.timeoutId);
          this.pendingFlow.reject(new Error("OAuth flow cancelled"));
          this.pendingFlow = null;
        }
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Wait for OAuth callback via deep link (production).
   */
  private async waitForDeepLinkCallback(
    codeVerifier: string,
    config: OAuthConfig,
    authUrl: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingFlow = null;
        reject(new Error("Authorization timed out"));
      }, OAUTH_TIMEOUT_MS);

      this.pendingFlow = {
        codeVerifier,
        config,
        resolve,
        reject,
        timeoutId,
      };

      // Open the browser for authentication
      this.urlLauncher.launch(authUrl).catch((error) => {
        clearTimeout(timeoutId);
        this.pendingFlow = null;
        reject(new Error(`Failed to open browser: ${error.message}`));
      });
    });
  }

  /**
   * Wait for OAuth callback via HTTP server (development).
   */
  private async waitForHttpCallback(
    codeVerifier: string,
    config: OAuthConfig,
    authUrl: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const connections = new Set<Socket>();

      const server = http.createServer((req, res) => {
        if (!req.url) {
          res.writeHead(400);
          res.end();
          return;
        }

        const url = new URL(req.url, `http://localhost:${DEV_CALLBACK_PORT}`);

        if (url.pathname === "/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(
              this.getCallbackHtml(
                error === "access_denied" ? "cancelled" : "error",
              ),
            );
            this.cleanupHttpServer();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (code) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(this.getCallbackHtml("success"));
            this.cleanupHttpServer();
            resolve(code);
            return;
          }

          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(this.getCallbackHtml("error"));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.on("connection", (conn) => {
        connections.add(conn);
        conn.on("close", () => connections.delete(conn));
      });

      const timeoutId = setTimeout(() => {
        this.cleanupHttpServer();
        reject(new Error("Authorization timed out"));
      }, OAUTH_TIMEOUT_MS);

      this.pendingFlow = {
        codeVerifier,
        config,
        resolve,
        reject,
        timeoutId,
        server,
        connections,
      };

      server.listen(DEV_CALLBACK_PORT, () => {
        log.info(
          `Dev OAuth callback server listening on port ${DEV_CALLBACK_PORT}`,
        );
        // Open the browser for authentication
        this.urlLauncher.launch(authUrl).catch((error) => {
          this.cleanupHttpServer();
          reject(new Error(`Failed to open browser: ${error.message}`));
        });
      });

      server.on("error", (error) => {
        this.cleanupHttpServer();
        reject(new Error(`Failed to start callback server: ${error.message}`));
      });
    });
  }

  /**
   * Generate HTML for the callback page.
   */
  private getCallbackHtml(status: "success" | "cancelled" | "error"): string {
    const titles = {
      success: "Authorization successful!",
      cancelled: "Authorization cancelled",
      error: "Authorization failed",
    };
    const messages = {
      success: "You can close this window and return to PostHog Code.",
      cancelled: "You can close this window and return to PostHog Code.",
      error: "You can close this window and return to PostHog Code.",
    };

    return `<!DOCTYPE html>
<html class="radix-themes" data-is-root-theme="true" data-accent-color="orange" data-gray-color="slate" data-has-background="true" data-panel-background="translucent" data-radius="none" data-scaling="100%">
  <head>
    <meta charset="utf-8">
    <title>${titles[status]}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@radix-ui/themes@3.1.6/styles.css">
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      @layer utilities {
        .text-gray-12 { color: var(--gray-12); }
        .text-gray-11 { color: var(--gray-11); }
        .bg-gray-1 { background-color: var(--gray-1); }
      }
    </style>
  </head>
  <body class="dark bg-gray-1 h-screen overflow-hidden flex flex-col items-center justify-center m-0 gap-2">
    <h1 class="text-gray-12 text-xl font-semibold">${titles[status]}</h1>
    <p class="text-gray-11 text-sm">${messages[status]}</p>
    <script>setTimeout(() => window.close(), 500);</script>
  </body>
</html>`;
  }

  /**
   * Clean up HTTP server used in development.
   */
  private cleanupHttpServer(): void {
    if (this.pendingFlow?.server) {
      // Destroy all connections
      if (this.pendingFlow.connections) {
        for (const conn of this.pendingFlow.connections) {
          conn.destroy();
        }
        this.pendingFlow.connections.clear();
      }
      this.pendingFlow.server.close();
    }
    if (this.pendingFlow?.timeoutId) {
      clearTimeout(this.pendingFlow.timeoutId);
    }
    this.pendingFlow = null;
  }

  private async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
    config: OAuthConfig,
  ): Promise<OAuthTokenResponse> {
    const cloudUrl = getCloudUrlFromRegion(config.cloudRegion);
    const redirectUri = this.getRedirectUri();
    const body = JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: getOauthClientIdFromRegion(config.cloudRegion),
      code_verifier: codeVerifier,
    });

    let lastError = "Token exchange failed";

    for (let attempt = 0; attempt < TOKEN_FETCH_MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${cloudUrl}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      } catch (error) {
        // fetch threw — DNS/TLS/socket failure. The raw message ("Failed to fetch",
        // "fetch failed", "terminated", etc.) leaks to the UI as-is, so we replace
        // it with something users can act on.
        lastError = NETWORK_ERROR_MESSAGE;
        log.warn("Token exchange network error", {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt === TOKEN_FETCH_MAX_ATTEMPTS - 1) break;
        await sleepWithBackoff(attempt, TOKEN_FETCH_BACKOFF);
        continue;
      }

      if (response.ok) {
        return response.json();
      }

      lastError = `Token exchange failed: ${response.status} ${response.statusText}`;
      const isServerError = response.status >= 500;
      if (!isServerError) {
        throw new Error(lastError);
      }

      log.warn("Token exchange server error", {
        attempt,
        status: response.status,
      });
      if (attempt === TOKEN_FETCH_MAX_ATTEMPTS - 1) break;
      await sleepWithBackoff(attempt, TOKEN_FETCH_BACKOFF);
    }

    throw new Error(lastError);
  }

  private buildAuthorizeUrl(region: CloudRegion, codeVerifier: string): URL {
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const redirectUri = this.getRedirectUri();
    const cloudUrl = getCloudUrlFromRegion(region);
    const authUrl = new URL(`${cloudUrl}/oauth/authorize`);
    authUrl.searchParams.set("client_id", getOauthClientIdFromRegion(region));
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("scope", OAUTH_SCOPES.join(" "));
    authUrl.searchParams.set("required_access_level", "project");
    return authUrl;
  }

  private buildSignupUrl(region: CloudRegion, authUrl: URL): URL {
    const cloudUrl = getCloudUrlFromRegion(region);
    const signupUrl = new URL(`${cloudUrl}/signup`);
    const nextPath = `${authUrl.pathname}${authUrl.search}`;
    signupUrl.searchParams.set("next", nextPath);
    return signupUrl;
  }

  private async startFlowWithUrl(
    config: OAuthConfig,
    codeVerifier: string,
    authUrl: string,
  ): Promise<StartFlowOutput> {
    const code = isDevBuild()
      ? await this.waitForHttpCallback(codeVerifier, config, authUrl)
      : await this.waitForDeepLinkCallback(codeVerifier, config, authUrl);

    const tokenResponse = await this.exchangeCodeForToken(
      code,
      codeVerifier,
      config,
    );

    return {
      success: true,
      data: tokenResponse,
    };
  }

  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  private generateCodeChallenge(verifier: string): string {
    return crypto.createHash("sha256").update(verifier).digest("base64url");
  }

  /**
   * Open an external URL in the default browser.
   */
  public async openExternalUrl(url: string): Promise<void> {
    await this.urlLauncher.launch(url);
  }
}
