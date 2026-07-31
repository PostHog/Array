/**
 * Query builders for the Product View's PostHog data fetches. Pure string
 * building only — execution lives in ProductViewService, which injects auth.
 * Everything page-derived is treated as untrusted input: JSON-encoded (never
 * string-interpolated into filters) and length-capped.
 */

import type { EmbeddedBrowserElement } from "@posthog/platform/embedded-browser";

const PATHNAME_CAP = 1000;
const STATS_ROW_LIMIT = 200;

/** Escape a page-derived value for a single-quoted HogQL string literal. */
function escapeString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

/** Additionally neutralize LIKE wildcards for `elements_chain LIKE` patterns. */
function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

const quotedPath = (pathname: string): string =>
  `'${escapeString(pathname.slice(0, PATHNAME_CAP))}'`;

/**
 * The `elements_chain LIKE` fragment identifying one element in historical
 * autocapture data, from its strongest stable key. Null when the element has
 * nothing worth matching on (then the details panel shows page context only).
 */
export function buildElementChainFragment(
  element: EmbeddedBrowserElement,
): string | null {
  if (element.dataAttr)
    return `%attr__data-attr="${escapeLike(element.dataAttr)}"%`;
  if (element.id) return `%attr__id="${escapeLike(element.id)}"%`;
  if (element.href) return `%href="${escapeLike(element.href)}"%`;
  if (element.text) return `%text="${escapeLike(element.text)}"%`;
  return null;
}

/** Daily clicks + unique persons on the element over the last 30 days.
 * (Query shape validated against the live posthog.com project.) */
export function buildElementTrendQuery(
  pathname: string,
  chainFragment: string,
): string {
  return [
    "SELECT toStartOfDay(timestamp) AS day, count() AS clicks, uniq(person_id) AS users",
    "FROM events",
    "WHERE event = '$autocapture'",
    `  AND properties.$pathname = ${quotedPath(pathname)}`,
    `  AND elements_chain LIKE '${chainFragment}'`,
    "  AND timestamp > now() - INTERVAL 30 DAY",
    "GROUP BY day ORDER BY day",
  ].join("\n");
}

/** Exceptions raised in the same sessions that interacted with the element —
 * the "what breaks for people who use this" correlation. */
export function buildElementErrorsQuery(
  pathname: string,
  chainFragment: string,
): string {
  return [
    "SELECT properties.$exception_issue_id AS issue_id, any(properties.$exception_types) AS types,",
    "       count() AS occurrences, uniq(person_id) AS affected_users",
    "FROM events",
    "WHERE event = '$exception' AND timestamp > now() - INTERVAL 7 DAY",
    "  AND `$session_id` IN (",
    "    SELECT `$session_id` FROM events",
    "    WHERE event = '$autocapture'",
    `      AND properties.$pathname = ${quotedPath(pathname)}`,
    `      AND elements_chain LIKE '${chainFragment}'`,
    "      AND timestamp > now() - INTERVAL 7 DAY AND `$session_id` != ''",
    "  )",
    "GROUP BY issue_id ORDER BY occurrences DESC LIMIT 10",
  ].join("\n");
}

/** Most recent sessions that interacted with the element (replay links). */
export function buildElementSessionsQuery(
  pathname: string,
  chainFragment: string,
): string {
  return [
    "SELECT `$session_id` AS session_id, max(timestamp) AS last_seen",
    "FROM events",
    "WHERE event = '$autocapture'",
    `  AND properties.$pathname = ${quotedPath(pathname)}`,
    `  AND elements_chain LIKE '${chainFragment}'`,
    "  AND `$session_id` != '' AND timestamp > now() - INTERVAL 7 DAY",
    "GROUP BY session_id ORDER BY last_seen DESC LIMIT 5",
  ].join("\n");
}

/** Page-level web-vitals context (p75 INP + LCP over 7 days). */
export function buildPageVitalsQuery(pathname: string): string {
  return [
    "SELECT round(quantile(0.75)(toFloat(properties.$web_vitals_INP_value))) AS inp_p75,",
    "       round(quantile(0.75)(toFloat(properties.$web_vitals_LCP_value))) AS lcp_p75",
    "FROM events",
    `WHERE event = '$web_vitals' AND properties.$pathname = ${quotedPath(pathname)}`,
    "  AND timestamp > now() - INTERVAL 7 DAY",
  ].join("\n");
}

// ── Row shapers (raw /query/ grids → view models) ──

export interface ElementTrendPoint {
  day: string;
  clicks: number;
  users: number;
}

export function shapeTrendRows(results: unknown[]): ElementTrendPoint[] {
  const points: ElementTrendPoint[] = [];
  for (const row of results) {
    if (!Array.isArray(row)) continue;
    const [day, clicks, users] = row;
    if (typeof day !== "string" || typeof clicks !== "number") continue;
    points.push({ day, clicks, users: typeof users === "number" ? users : 0 });
  }
  return points;
}

export interface ElementErrorIssue {
  issueId: string;
  types: string[];
  occurrences: number;
  affectedUsers: number;
}

export function shapeErrorRows(results: unknown[]): ElementErrorIssue[] {
  const issues: ElementErrorIssue[] = [];
  for (const row of results) {
    if (!Array.isArray(row)) continue;
    const [issueId, types, occurrences, affectedUsers] = row;
    if (typeof issueId !== "string" || typeof occurrences !== "number") {
      continue;
    }
    let parsedTypes: string[] = [];
    if (typeof types === "string") {
      try {
        const value = JSON.parse(types);
        if (Array.isArray(value)) parsedTypes = value.map(String);
      } catch {
        parsedTypes = [types];
      }
    } else if (Array.isArray(types)) {
      parsedTypes = types.map(String);
    }
    issues.push({
      issueId,
      types: parsedTypes,
      occurrences,
      affectedUsers: typeof affectedUsers === "number" ? affectedUsers : 0,
    });
  }
  return issues;
}

export interface ElementSessionRef {
  sessionId: string;
  lastSeen: string;
}

export function shapeSessionRows(results: unknown[]): ElementSessionRef[] {
  const sessions: ElementSessionRef[] = [];
  for (const row of results) {
    if (!Array.isArray(row)) continue;
    const [sessionId, lastSeen] = row;
    if (typeof sessionId !== "string" || typeof lastSeen !== "string") continue;
    sessions.push({ sessionId, lastSeen });
  }
  return sessions;
}

export interface PageVitals {
  inpP75: number;
  lcpP75: number;
}

export function shapeVitalsRow(results: unknown[]): PageVitals | null {
  const row = results[0];
  if (!Array.isArray(row)) return null;
  const [inp, lcp] = row;
  if (typeof inp !== "number" && typeof lcp !== "number") return null;
  return {
    inpP75: typeof inp === "number" ? inp : 0,
    lcpP75: typeof lcp === "number" ? lcp : 0,
  };
}

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
