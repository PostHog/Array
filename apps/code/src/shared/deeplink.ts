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

/**
 * Build the deep link URL for an inbox report. The optional title is slugified
 * and appended as a trailing path segment for human-readable sharing; the
 * receiver only reads the UUID, so the slug is purely cosmetic.
 *
 * Slug rules:
 * - Accented Latin letters are folded to their ASCII base (`café` → `cafe`)
 *   via NFD decomposition + combining-mark stripping.
 * - Letters, digits, and the URL-unreserved punctuation `_ . ~` are kept
 *   verbatim (case preserved).
 * - Any run of other characters collapses to a single `-`, except runs that
 *   mix a colon with other unsafe chars collapse to `--`. This preserves the
 *   title-like break in `fix(inbox): Add foo` → `fix-inbox--Add-foo` while
 *   keeping standalone colons compact (`feat:bar` → `feat-bar`) and unrelated
 *   runs single (`Cost $5, 50% off` → `Cost-5-50-off`).
 * - Leading and trailing hyphens are stripped.
 */
export function buildInboxDeeplink(
  reportId: string,
  title: string | null | undefined,
  { isDevBuild }: { isDevBuild: boolean },
): string {
  const base = `${getDeeplinkProtocol(isDevBuild)}://inbox/${reportId}`;
  const slug = title
    ? title
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[^a-zA-Z0-9_.~]+/g, (run) =>
          run.includes(":") && /[^:]/.test(run) ? "--" : "-",
        )
        .replace(/^-+|-+$/g, "")
    : "";
  return slug ? `${base}/${slug}` : base;
}
