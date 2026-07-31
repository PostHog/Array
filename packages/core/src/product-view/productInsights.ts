/**
 * Query builders for the Product View's PostHog data fetches. Pure string
 * building only — execution lives in ProductViewService, which injects auth.
 * Everything page-derived is treated as untrusted input: JSON-encoded (never
 * string-interpolated into filters) and length-capped.
 */

const PATHNAME_CAP = 1000;
const STATS_ROW_LIMIT = 200;

/** Query string for GET /api/projects/{id}/elements/stats/ scoped to a page:
 * autocapture + rage + dead clicks over the last 7 days. */
export function elementStatsQuery(pathname: string): string {
  const params = new URLSearchParams();
  params.set("date_from", "-7d");
  params.set("limit", String(STATS_ROW_LIMIT));
  params.set(
    "include",
    JSON.stringify(["$autocapture", "$rageclick", "$dead_click"]),
  );
  params.set(
    "properties",
    JSON.stringify([
      {
        key: "$pathname",
        value: pathname.slice(0, PATHNAME_CAP),
        operator: "exact",
        type: "event",
      },
    ]),
  );
  return params.toString();
}
