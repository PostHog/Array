import * as crypto from "node:crypto";
import * as http from "node:http";
import type { Socket } from "node:net";
import { ipcMain, safeStorage, shell } from "electron";
import {
  getCloudUrlFromRegion,
  getOauthClientIdFromRegion,
  OAUTH_PORT,
  OAUTH_SCOPES,
} from "../../constants/oauth";
import type {
  CloudRegion,
  OAuthConfig,
  OAuthTokenResponse,
  StoredOAuthTokens,
} from "../../shared/types/oauth";

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

async function startCallbackServer(authUrl: string): Promise<{
  server: http.Server;
  waitForCallback: () => Promise<string>;
  closeServer: () => void;
}> {
  return new Promise((resolve, reject) => {
    let callbackResolve: (code: string) => void;
    let callbackReject: (error: Error) => void;

    const waitForCallback = () =>
      new Promise<string>((res, rej) => {
        callbackResolve = res;
        callbackReject = rej;
      });

    const connections = new Set<Socket>();
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, `http://localhost:${OAUTH_PORT}`);

      if (url.pathname === "/authorize") {
        res.writeHead(302, { Location: authUrl });
        res.end();
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        const isAccessDenied = error === "access_denied";
        res.writeHead(isAccessDenied ? 200 : 400, {
          "Content-Type": "text/html",
        });
        res.end(`
          <html>
            <body>
              <p>${
                isAccessDenied
                  ? "Authorization cancelled."
                  : `Authorization failed.`
              }</p>
              <p>Return to Array. This window will close automatically.</p>
              <script>window.close();</script>
            </body>
          </html>
        `);
        callbackReject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body>
              <p>Authorization successful! Return to Array.</p>
              <script>window.close();</script>
            </body>
          </html>
        `);
        callbackResolve(code);
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body>
              <p>Invalid request - no authorization code received.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
      }
    });

    // Track connections
    server.on("connection", (conn) => {
      connections.add(conn);
      conn.on("close", () => {
        connections.delete(conn);
      });
    });

    const closeServer = () => {
      // Destroy all active connections
      for (const conn of connections) {
        conn.destroy();
      }
      connections.clear();
      server.close();
    };

    server.listen(OAUTH_PORT, () => {
      resolve({ server, waitForCallback, closeServer });
    });

    server.on("error", reject);
  });
}

async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  config: OAuthConfig,
): Promise<OAuthTokenResponse> {
  const cloudUrl = getCloudUrlFromRegion(config.cloudRegion);

  const response = await fetch(`${cloudUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: `http://localhost:${OAUTH_PORT}/callback`,
      client_id: getOauthClientIdFromRegion(config.cloudRegion),
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.statusText}`);
  }

  return response.json();
}

async function refreshTokenRequest(
  refreshToken: string,
  region: CloudRegion,
): Promise<OAuthTokenResponse> {
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
    throw new Error(`Token refresh failed: ${response.statusText}`);
  }

  return response.json();
}

function encryptTokens(tokens: StoredOAuthTokens): string {
  const json = JSON.stringify(tokens);
  const buffer = safeStorage.encryptString(json);
  return buffer.toString("base64");
}

function decryptTokens(encrypted: string): StoredOAuthTokens | null {
  try {
    const buffer = Buffer.from(encrypted, "base64");
    const json = safeStorage.decryptString(buffer);
    return JSON.parse(json);
  } catch (error) {
    console.error("Failed to decrypt tokens:", error);
    return null;
  }
}

let activeCloseServer: (() => void) | null = null;

export async function performOAuthFlow(
  config: OAuthConfig,
): Promise<OAuthTokenResponse> {
  const cloudUrl = getCloudUrlFromRegion(config.cloudRegion);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authUrl = new URL(`${cloudUrl}/oauth/authorize`);
  authUrl.searchParams.set(
    "client_id",
    getOauthClientIdFromRegion(config.cloudRegion),
  );
  authUrl.searchParams.set(
    "redirect_uri",
    `http://localhost:${OAUTH_PORT}/callback`,
  );
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("scope", config.scopes.join(" "));
  authUrl.searchParams.set("required_access_level", "project");

  const localLoginUrl = `http://localhost:${OAUTH_PORT}/authorize`;

  const { closeServer, waitForCallback } = await startCallbackServer(
    authUrl.toString(),
  );

  activeCloseServer = closeServer;

  // Open browser
  await shell.openExternal(localLoginUrl);

  try {
    const code = await Promise.race([
      waitForCallback(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Authorization timed out")), 30_000),
      ),
    ]);

    const token = await exchangeCodeForToken(code, codeVerifier, config);

    closeServer();
    activeCloseServer = null;

    return token;
  } catch (error) {
    closeServer();
    activeCloseServer = null;
    throw error;
  }
}

export function registerOAuthHandlers(): void {
  ipcMain.handle("oauth:start-flow", async (_, region: CloudRegion) => {
    try {
      // Close any existing server before starting a new flow
      if (activeCloseServer) {
        activeCloseServer();
        activeCloseServer = null;
      }

      const config: OAuthConfig = {
        scopes: OAUTH_SCOPES,
        cloudRegion: region,
      };

      const tokenResponse = await performOAuthFlow(config);

      return {
        success: true,
        data: tokenResponse,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  ipcMain.handle(
    "oauth:encrypt-tokens",
    async (_, tokens: StoredOAuthTokens) => {
      try {
        const encrypted = encryptTokens(tokens);
        return {
          success: true,
          encrypted,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );

  ipcMain.handle("oauth:retrieve-tokens", async (_, encrypted: string) => {
    try {
      const tokens = decryptTokens(encrypted);
      if (!tokens) {
        return {
          success: false,
          error: "Failed to decrypt tokens",
        };
      }
      return {
        success: true,
        data: tokens,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  ipcMain.handle("oauth:delete-tokens", async () => {
    // Nothing to do in main process for deletion
    // Renderer will handle removing from localStorage
    return { success: true };
  });

  ipcMain.handle(
    "oauth:refresh-token",
    async (_, refreshToken: string, region: CloudRegion) => {
      try {
        const tokenResponse = await refreshTokenRequest(refreshToken, region);
        return {
          success: true,
          data: tokenResponse,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  );
}
