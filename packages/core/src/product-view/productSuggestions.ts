/**
 * Pure builders + shapers behind ProductViewService.suggestProductUrls():
 * candidate "this is your product" origins for a PostHog project, derived from
 * the project's own data — its configured toolbar `app_urls` and the hosts its
 * `$pageview` events actually report. Query building and row shaping are pure
 * so they're unit-testable without the client (agent-analytics pattern).
 */

export interface ProductUrlSuggestion {
  /** A bare origin, e.g. `https://us.posthog.com` or `http://localhost:8010`. */
  url: string;
  source: "app_urls" | "pageview_hosts";
  /** 7-day $pageview volume for pageview-host suggestions. */
  eventCount?: number;
}

const HOSTS_LIMIT = 10;

/** Top $pageview hosts over the last 7 days — no user input interpolated. */
export function buildHostsQuery(): string {
  return [
    "SELECT properties.$host AS host, count() AS pageviews",
    "FROM events",
    "WHERE event = '$pageview' AND timestamp > now() - INTERVAL 7 DAY",
    "GROUP BY host",
    "ORDER BY pageviews DESC",
    `LIMIT ${HOSTS_LIMIT}`,
  ].join("\n");
}

function isLocalHost(host: string): boolean {
  const name = host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "0.0.0.0";
}

/** Normalize an app_urls entry (may carry paths or `/*` wildcards) to a bare
 * origin; null when it isn't a usable http(s) URL. */
function originFromAppUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** A `$host` property is `host[:port]`; scheme is not captured, so assume
 * https except for local hosts (which are plain-http dev servers). */
function originFromHost(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const scheme = isLocalHost(value) ? "http" : "https";
  try {
    return new URL(`${scheme}://${value}`).origin;
  } catch {
    return null;
  }
}

export function shapeUrlSuggestions(
  appUrls: unknown[],
  hostRows: unknown[],
): ProductUrlSuggestion[] {
  const suggestions: ProductUrlSuggestion[] = [];
  const seen = new Set<string>();

  for (const entry of appUrls) {
    const origin = originFromAppUrl(entry);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    suggestions.push({ url: origin, source: "app_urls" });
  }

  for (const row of hostRows) {
    if (!Array.isArray(row)) continue;
    const origin = originFromHost(row[0]);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    const count = typeof row[1] === "number" ? row[1] : undefined;
    suggestions.push({
      url: origin,
      source: "pageview_hosts",
      ...(count !== undefined ? { eventCount: count } : {}),
    });
  }

  return suggestions;
}
