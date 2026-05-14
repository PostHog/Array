/**
 * Deep-link URL construction for the mobile app.
 *
 * Path shape mirrors the desktop app (apps/code/src/shared/deeplink.ts and
 * the registered handlers in main/services/*-link/) so a single URL can route
 * to either client:
 *   posthog://task/<taskId>
 *   posthog://task/<taskId>/run/<runId>
 *   posthog://inbox/<reportId>
 *
 * Mobile uses the `posthog://` custom scheme (registered in app.json) and
 * https://code.posthog.com as the universal-link host. Both share the same
 * path shape, so a `code.posthog.com/task/X` URL opens the same screen as
 * `posthog://task/X`.
 *
 * For in-app navigation, prefer the `paths.*` helpers — they return the
 * router-relative path that `router.push()` expects. For external/shareable
 * links (push notifications, Slack messages, copy-link buttons), use
 * `universalUrl()` or `customSchemeUrl()`.
 */

export const MOBILE_SCHEME = "posthog";
export const UNIVERSAL_LINK_HOST = "code.posthog.com";
export const UNIVERSAL_LINK_PREFIX = `https://${UNIVERSAL_LINK_HOST}`;

/**
 * Router-relative paths used inside the app with `router.push()` /
 * `router.replace()`. These are also the path shape that expo-router maps
 * incoming deep links to.
 */
export const paths = {
  tasksTab: "/(tabs)/tasks" as const,
  inboxTab: "/(tabs)/inbox" as const,
  automationsTab: "/(tabs)/automations" as const,
  settings: "/settings" as const,
  newTask: "/task" as const,
  task: (taskId: string) => `/task/${taskId}` as const,
  inboxReport: (reportId: string) => `/inbox/${reportId}` as const,
  automation: (automationId: string) => `/automation/${automationId}` as const,
  newAutomation: "/automation/create" as const,
  automationTemplates: "/automation" as const,
} as const;

/** A path is the part after the host: starts with `/`, no scheme. */
type AppPath = string;

/** Build a shareable `posthog://...` URL for an in-app path. */
export function customSchemeUrl(path: AppPath): string {
  const trimmed = path.replace(/^\/+/, "");
  return `${MOBILE_SCHEME}://${trimmed}`;
}

/** Build a shareable `https://code.posthog.com/...` URL for an in-app path. */
export function universalUrl(path: AppPath): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${UNIVERSAL_LINK_PREFIX}${normalized}`;
}

/**
 * Convert an incoming external URL (custom scheme or universal link) to the
 * router-relative path expo-router uses. Returns null if the URL doesn't
 * belong to us.
 *
 * Used by the auth gate to round-trip the originally-requested URL through
 * the sign-in flow.
 */
export function externalUrlToAppPath(url: string): AppPath | null {
  try {
    const parsed = new URL(url);

    if (parsed.protocol === `${MOBILE_SCHEME}:`) {
      // posthog://task/abc → /task/abc
      const host = parsed.hostname;
      if (!host) return null;
      const rest = parsed.pathname || "";
      const search = parsed.search || "";
      return `/${host}${rest}${search}`;
    }

    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.hostname === UNIVERSAL_LINK_HOST
    ) {
      // https://code.posthog.com/task/abc → /task/abc
      const path = parsed.pathname || "/";
      return `${path}${parsed.search || ""}`;
    }

    return null;
  } catch {
    return null;
  }
}
