import type { AuthService } from "@posthog/core/auth/auth";

// Thin authenticated helpers over the PostHog HTTP API, shared by the canvas
// services so the HogQL-query and current-user round-trips aren't duplicated.
// They take AuthService and use the ambient `fetch`; no caching here — callers
// cache as they see fit.

interface HogQLResponse {
  results?: unknown[];
  columns?: string[];
  error?: string | null;
}

export interface HogQLResult {
  columns: string[];
  /** Raw result rows from the query endpoint (each row is typically an array). */
  results: unknown[];
}

/**
 * Run a TYPED query node (`{ kind: "TrendsQuery" | "HogQLQuery" | … }`) against
 * the project's query endpoint and return its raw columns + rows. This is the
 * same endpoint + cache the insights/UI use, so a typed node returns the SAME
 * numbers the product shows. `refresh` selects the execution mode — pass
 * "blocking" for the cached avenue (serve a fresh cached result, else compute).
 * Throws on no selected project, an HTTP failure, or a query error; callers
 * map/shape the rows and decide how to treat an empty result.
 */
export async function runQuery(
  authService: AuthService,
  query: Record<string, unknown>,
  opts?: { refresh?: string },
): Promise<HogQLResult> {
  const { apiHost } = await authService.getValidAccessToken();
  const projectId = authService.getState().currentProjectId;
  if (projectId == null) {
    throw new Error("No PostHog project selected");
  }

  const response = await authService.authenticatedFetch(
    fetch,
    `${apiHost}/api/projects/${projectId}/query/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        ...(opts?.refresh ? { refresh: opts.refresh } : {}),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Query failed (${response.status})`);
  }
  const body = (await response.json()) as HogQLResponse;
  if (body.error) throw new Error(body.error);

  return {
    columns: Array.isArray(body.columns) ? body.columns.map(String) : [],
    results: Array.isArray(body.results) ? body.results : [],
  };
}

/**
 * Run an inline HogQL string. A thin wrapper over {@link runQuery} that boxes the
 * SQL into a HogQLQuery node — the escape hatch for shapes a typed node can't
 * express. Prefer a typed node (TrendsQuery/etc.) for standard metrics.
 */
export async function runHogQLQuery(
  authService: AuthService,
  hogql: string,
  opts?: { refresh?: string },
): Promise<HogQLResult> {
  // `tags.productKey` attributes the query to a product so PostHog's
  // query-tagging guard is satisfied (it hard-fails untagged ClickHouse queries
  // in local dev). The desktop canvas/dashboard surfaces are the "max" product.
  return runQuery(
    authService,
    { kind: "HogQLQuery", query: hogql, tags: { productKey: "max" } },
    opts,
  );
}

export interface CurrentUser {
  /** The user's PostHog distinct_id (event attribution). */
  distinctId?: string;
  /** Display label: full name, else email. */
  label?: string;
}

/**
 * Fetch the signed-in user from /api/users/@me/. Returns null on failure (never
 * throws) so callers can degrade gracefully. No caching — callers cache.
 */
export async function fetchCurrentUser(
  authService: AuthService,
): Promise<CurrentUser | null> {
  try {
    const { apiHost } = await authService.getValidAccessToken();
    const res = await authService.authenticatedFetch(
      fetch,
      `${apiHost}/api/users/@me/`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      distinct_id?: string | null;
    };
    const name = [data.first_name, data.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    return {
      distinctId: data.distinct_id ?? undefined,
      label: name || data.email || undefined,
    };
  } catch {
    return null;
  }
}
