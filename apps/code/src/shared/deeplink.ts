/** Custom URL scheme for PostHog Code deep links (without `://`). */
export const DEEPLINK_PROTOCOL_PRODUCTION = "posthog-code";
export const DEEPLINK_PROTOCOL_DEVELOPMENT = "posthog-code-dev";

export function getDeeplinkProtocol(isDevBuild: boolean): string {
  return isDevBuild
    ? DEEPLINK_PROTOCOL_DEVELOPMENT
    : DEEPLINK_PROTOCOL_PRODUCTION;
}

/** True when `href` parses as a PostHog Code deep link (production or dev scheme). */
export function isPostHogCodeDeeplink(
  href: string | undefined,
): href is string {
  if (!href) return false;
  try {
    const protocol = new URL(href).protocol;
    return (
      protocol === `${DEEPLINK_PROTOCOL_PRODUCTION}:` ||
      protocol === `${DEEPLINK_PROTOCOL_DEVELOPMENT}:`
    );
  } catch {
    return false;
  }
}
