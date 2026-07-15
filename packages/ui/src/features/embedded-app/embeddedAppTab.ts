/**
 * EXPERIMENT (embedded webapp): browser-tab identity for embedded surfaces.
 *
 * A tab hosting the embedded PostHog webapp encodes its initial webapp path
 * into the tab's appView string ("embedded-app:<path>"). The browser-tabs
 * domain layer treats appView as an opaque string, so distinct paths are
 * distinct tab identities (dedup/focus works per path) with no schema change.
 */
const EMBEDDED_APP_TAB_PREFIX = "embedded-app:";

export function embeddedAppTabView(path: string): string {
  return `${EMBEDDED_APP_TAB_PREFIX}${path}`;
}

export function embeddedAppTabPath(appView: string | null): string | null {
  return appView?.startsWith(EMBEDDED_APP_TAB_PREFIX)
    ? appView.slice(EMBEDDED_APP_TAB_PREFIX.length)
    : null;
}

/**
 * Normalize a webapp URL into a stable tab path: kea-router prefixes
 * `/project/<id>` onto every in-app URL, which would make "/notebooks" and
 * "/project/2/notebooks" two different tab identities for the same surface.
 */
export function normalizeEmbedPath(url: string): string {
  const withoutProject = url.replace(/^\/project\/[^/]+/, "");
  return withoutProject === "" ? "/" : withoutProject;
}
