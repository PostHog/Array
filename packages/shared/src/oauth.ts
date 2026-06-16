import type { CloudRegion } from "./regions";

export const POSTHOG_US_CLIENT_ID = "HCWoE0aRFMYxIxFNTTwkOORn5LBjOt2GVDzwSw5W";
export const POSTHOG_EU_CLIENT_ID = "AIvijgMS0dxKEmr5z6odvRd8Pkh5vts3nPTzgzU9";
export const POSTHOG_DEV_CLIENT_ID = "DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ";

// Bump OAUTH_SCOPE_VERSION below whenever OAUTH_SCOPES changes to force re-authentication.
//
// `agent_approvals:write` is enumerated alongside `*` because the Django decide
// gate on `allow_agent_approver: false` approvals (see agent_platform's
// presentation/views.py:approvals_decide) does not accept `*` as a substitute —
// it's modeled on the same hardening as INTERNAL scopes (posthog/permissions.py).
// Without the explicit scope, the in-chat approval card + the per-agent
// Approvals tab 404 when deciding human-only approvals.
export const OAUTH_SCOPES = ["*", "agent_approvals:write"];

export const OAUTH_SCOPE_VERSION = 6;

// Token refresh settings
export const TOKEN_REFRESH_BUFFER_MS = 30 * 60 * 1000; // 30 minutes before expiry
export const TOKEN_REFRESH_FORCE_MS = 60 * 1000; // Force refresh when <1 min to expiry, even with active sessions

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
