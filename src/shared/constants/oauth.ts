import type { CloudRegion } from "../types/oauth";

export const POSTHOG_US_CLIENT_ID = "HCWoE0aRFMYxIxFNTTwkOORn5LBjOt2GVDzwSw5W";
export const POSTHOG_EU_CLIENT_ID = "AIvijgMS0dxKEmr5z6odvRd8Pkh5vts3nPTzgzU9";
export const POSTHOG_DEV_CLIENT_ID = "DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ";

export const OAUTH_PORT = 8237;

export const OAUTH_SCOPES = [
  "user:read",
  "project:read",
  "task:write",
  "integration:read",
];

// Token refresh settings
export const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

export function getCloudUrlFromRegion(region: CloudRegion): string {
  switch (region) {
    case "us":
      return "https://us.posthog.com";
    case "eu":
      return "https://eu.posthog.com";
    case "dev":
      return "http://localhost:8010";
  }
}

export function getOauthClientIdFromRegion(region: CloudRegion): string {
  switch (region) {
    case "us":
      return POSTHOG_US_CLIENT_ID;
    case "eu":
      return POSTHOG_EU_CLIENT_ID;
    case "dev":
      return POSTHOG_DEV_CLIENT_ID;
  }
}
