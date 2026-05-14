import { fetch } from "expo/fetch";
import Constants from "expo-constants";
import { useAuthStore } from "@/features/auth";
import { logger } from "@/lib/logger";

const log = logger.scope("api");

const USER_AGENT = `posthog/mobile.hog.dev; version: ${Constants.expoConfig?.version ?? "unknown"}`;

export function getHeaders(): Record<string, string> {
  const { oauthAccessToken } = useAuthStore.getState();
  if (!oauthAccessToken) {
    throw new Error("Not authenticated");
  }
  return {
    Authorization: `Bearer ${oauthAccessToken}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
}

export function getAccessToken(): string {
  const { oauthAccessToken } = useAuthStore.getState();
  if (!oauthAccessToken) {
    throw new Error("Not authenticated");
  }
  return oauthAccessToken;
}

export function getBaseUrl(): string {
  const { cloudRegion, getCloudUrlFromRegion } = useAuthStore.getState();
  if (!cloudRegion) {
    throw new Error("No cloud region set");
  }
  return getCloudUrlFromRegion(cloudRegion);
}

export function getProjectId(): number {
  const { projectId } = useAuthStore.getState();
  if (!projectId) {
    throw new Error("No project ID set");
  }
  return projectId;
}

export async function registerPushToken(args: {
  token: string;
  platform: string;
}): Promise<void> {
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  // Push tokens are per-user, not per-project — endpoint lives under
  // /api/users/@me/ alongside the other user-scoped APIs.
  const url = `${baseUrl}/api/users/@me/push_tokens/`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    log.warn("registerPushToken failed", {
      url,
      status: response.status,
      statusText: response.statusText,
      body: body.slice(0, 500),
    });
    throw new Error(
      `registerPushToken failed: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`,
    );
  }
}

export async function deletePushToken(args: { token: string }): Promise<void> {
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  // Unregister is a POST sub-action (not DELETE) because some clients and
  // proxies strip request bodies on DELETE.
  const response = await fetch(
    `${baseUrl}/api/users/@me/push_tokens/unregister/`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(args),
    },
  );

  if (!response.ok) {
    log.debug("deletePushToken non-OK response", {
      status: response.status,
    });
  }
}
