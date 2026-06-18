import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { inject, injectable } from "inversify";
import type {
  CanvasCaptureConfig,
  CanvasCaptureInput,
  CanvasCaptureResult,
  CanvasDataQueryInput,
  CanvasDataResult,
} from "./freeformSchemas";

interface HogQLResponse {
  results?: unknown[];
  columns?: string[];
  error?: string | null;
}

// Last-resort attribution if we can't resolve the signed-in user (and the
// canvas didn't pass its own distinctId).
const FALLBACK_DISTINCT_ID = "freeform-canvas";

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
  // The project's public capture key (phc_…), fetched once and reused.
  private projectToken: string | undefined;
  // The signed-in user's distinct_id, the default attribution in edit mode.
  private userDistinctId: string | undefined;

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

  // The bootstrap config the iframe needs to run posthog-js (analytics +
  // session replay) itself: the public capture key + the signed-in user's
  // distinct_id. The private read token is never included.
  async captureConfig(): Promise<CanvasCaptureConfig> {
    const { apiHost } = await this.authService.getValidAccessToken();
    const projectId = this.authService.getState().currentProjectId;
    if (projectId == null) {
      throw new Error("No PostHog project selected");
    }
    const [publicKey, distinctId] = await Promise.all([
      this.getProjectToken(apiHost, projectId),
      this.getUserDistinctId(apiHost),
    ]);
    return { apiHost, publicKey, distinctId };
  }

  // Send an analytics event to the host's project using the PUBLIC project key.
  // This is the `ph.capture` avenue: the canvas never holds a key, the host
  // attaches the (safe-to-be-public) capture token and posts the event.
  async capture(input: CanvasCaptureInput): Promise<CanvasCaptureResult> {
    const { apiHost } = await this.authService.getValidAccessToken();
    const projectId = this.authService.getState().currentProjectId;
    if (projectId == null) {
      throw new Error("No PostHog project selected");
    }

    const apiKey = await this.getProjectToken(apiHost, projectId);
    // Attribution order: an explicit distinctId the canvas passed (e.g. a
    // per-visitor id once sharing exists) wins; otherwise the signed-in user
    // (edit mode); otherwise a stable fallback.
    const distinctId =
      input.distinctId ??
      (await this.getUserDistinctId(apiHost)) ??
      FALLBACK_DISTINCT_ID;
    const response = await fetch(`${apiHost}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: input.event,
        distinct_id: distinctId,
        properties: {
          ...input.properties,
          // Mark provenance so these are easy to find/filter in the project.
          $lib: "posthog-canvas",
        },
      }),
    });

    if (!response.ok) {
      this.log.warn("Canvas capture failed", { status: response.status });
      throw new Error(`Capture failed (${response.status})`);
    }
    return { ok: true };
  }

  // The project's public capture key. Fetched from the authenticated project
  // endpoint (which the user can already read) and cached; capture itself uses
  // the public key, not the bearer token.
  private async getProjectToken(
    apiHost: string,
    projectId: number,
  ): Promise<string> {
    if (this.projectToken) return this.projectToken;
    const res = await this.authService.authenticatedFetch(
      fetch,
      `${apiHost}/api/projects/${projectId}/`,
    );
    if (!res.ok) {
      throw new Error(`Couldn't read project key (${res.status})`);
    }
    const data = (await res.json()) as { api_token?: string };
    if (!data.api_token) throw new Error("Project has no capture key");
    this.projectToken = data.api_token;
    return this.projectToken;
  }

  // The signed-in user's distinct_id (so edit-mode captures attribute to "me" in
  // PostHog, not a placeholder). Cached; returns undefined if unavailable.
  private async getUserDistinctId(
    apiHost: string,
  ): Promise<string | undefined> {
    if (this.userDistinctId !== undefined) return this.userDistinctId;
    try {
      const res = await this.authService.authenticatedFetch(
        fetch,
        `${apiHost}/api/users/@me/`,
      );
      if (!res.ok) return undefined;
      const data = (await res.json()) as { distinct_id?: string };
      this.userDistinctId = data.distinct_id;
      return this.userDistinctId;
    } catch {
      return undefined;
    }
  }
}
