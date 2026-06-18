import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { inject, injectable } from "inversify";
import type { CanvasDataQueryInput, CanvasDataResult } from "./freeformSchemas";

interface HogQLResponse {
  results?: unknown[];
  columns?: string[];
  error?: string | null;
}

/**
 * The host-side data avenue behind a freeform canvas's `ph.query` shim.
 *
 * Runs HogQL through PostHog's cached query runner — the SAME avenue insights
 * use, so caching and cold-boot are handled for us — by passing
 * `refresh: "blocking"` (return a fresh cached result if one exists, else
 * compute synchronously). The PostHog token is injected here via
 * `authenticatedFetch`; it never crosses into the iframe.
 *
 * Edit-mode only for now (inline HogQL). The published/view tier (Phase 3) will
 * reject inline HogQL and require a named, server-stored insight referenced by
 * `ph.run(name, params)`, validated against a per-canvas allowlist.
 */
@injectable()
export class CanvasDataService {
  private readonly log: ScopedLogger;

  constructor(
    @inject(AUTH_SERVICE)
    private readonly authService: AuthService,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("canvas-data");
  }

  async query(input: CanvasDataQueryInput): Promise<CanvasDataResult> {
    const { apiHost } = await this.authService.getValidAccessToken();
    const projectId = this.authService.getState().currentProjectId;
    if (projectId == null) {
      throw new Error("No PostHog project selected");
    }

    const url = `${apiHost}/api/projects/${projectId}/query/`;
    const response = await this.authService.authenticatedFetch(fetch, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query: input.hogql },
        // Cache-first execution (the insights avenue): serve a fresh cached
        // result if present, otherwise compute it now.
        refresh: "blocking",
      }),
    });

    if (!response.ok) {
      this.log.warn("Canvas query failed", { status: response.status });
      throw new Error(`Query failed (${response.status})`);
    }

    const body = (await response.json()) as HogQLResponse;
    if (body.error) {
      this.log.warn("Canvas query error", { error: body.error });
      throw new Error(body.error);
    }

    const rows = Array.isArray(body.results) ? body.results : [];
    return {
      columns: Array.isArray(body.columns) ? body.columns.map(String) : [],
      results: rows.map((r) => (Array.isArray(r) ? r : [r])),
    };
  }
}
