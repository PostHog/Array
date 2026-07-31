import type { AuthService } from "@posthog/core/auth/auth";
import { AUTH_SERVICE } from "@posthog/core/auth/auth.module";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import {
  EMBEDDED_BROWSER,
  type EmbeddedBrowserBounds,
  type EmbeddedBrowserEvent,
  type EmbeddedBrowserPageState,
  type IEmbeddedBrowser,
} from "@posthog/platform/embedded-browser";
import { inject, injectable } from "inversify";
import { runHogQLQuery } from "../canvas/posthogApi";
import {
  type ElementUsageStats,
  matchElementStats,
  shapeElementStatsResponse,
} from "./elementMatching";
import { buildOverlayItems } from "./healthScore";
import { elementStatsQuery } from "./productInsights";
import {
  buildHostsQuery,
  type ProductUrlSuggestion,
  shapeUrlSuggestions,
} from "./productSuggestions";
import { reportedElementsSchema } from "./schemas";

export interface IProductViewService {
  open(input: {
    viewId: string;
    url: string;
    bounds: EmbeddedBrowserBounds;
    dataProjectId?: number;
  }): Promise<void>;
  navigate(viewId: string, url: string): Promise<void>;
  goBack(viewId: string): void;
  goForward(viewId: string): void;
  reload(viewId: string): void;
  setBounds(viewId: string, bounds: EmbeddedBrowserBounds): void;
  setVisible(viewId: string, visible: boolean): void;
  destroy(viewId: string): Promise<void>;
  getPageState(viewId: string): EmbeddedBrowserPageState | null;
  setInspectMode(viewId: string, enabled: boolean): void;
  events(signal?: AbortSignal): AsyncIterable<EmbeddedBrowserEvent>;
  suggestProductUrls(): Promise<ProductUrlSuggestion[]>;
}

/** The embedded browser must only ever load plain web pages. */
function assertHttpUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Product View can only open http(s) URLs");
  }
  return url.toString();
}

/**
 * Orchestrates the Product View's embedded browser: validates navigation,
 * fans out page events, and derives "this is your product" URL suggestions
 * from the selected PostHog project's own data. Runs in the host's main
 * container (like CanvasDataService) — the renderer reaches it over tRPC and
 * PostHog credentials never leave the host side.
 */
const OVERLAY_MAX_ITEMS = 30;
const OVERLAY_DEBOUNCE_MS = 300;
const STATS_CACHE_TTL_MS = 5 * 60 * 1000;

@injectable()
export class ProductViewService implements IProductViewService {
  private readonly log: ScopedLogger;
  /** Which PostHog project each view's overlay reads from. */
  private readonly dataProjectByView = new Map<string, number>();
  /** Latest matched per-element stats per view (feeds the details panel). */
  private readonly statsByView = new Map<
    string,
    Map<string, ElementUsageStats>
  >();
  private readonly statsCache = new Map<
    string,
    { at: number; rows: ReturnType<typeof shapeElementStatsResponse> }
  >();
  private readonly overlayTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private overlayLoopStarted = false;

  constructor(
    @inject(EMBEDDED_BROWSER)
    private readonly embeddedBrowser: IEmbeddedBrowser,
    @inject(AUTH_SERVICE)
    private readonly authService: AuthService,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("product-view");
  }

  async open(input: {
    viewId: string;
    url: string;
    bounds: EmbeddedBrowserBounds;
    dataProjectId?: number;
  }): Promise<void> {
    const url = assertHttpUrl(input.url);
    if (input.dataProjectId !== undefined) {
      this.dataProjectByView.set(input.viewId, input.dataProjectId);
    }
    this.ensureOverlayLoop();
    await this.embeddedBrowser.create({
      viewId: input.viewId,
      url,
      bounds: input.bounds,
    });
  }

  /**
   * The overlay pipeline: inspector reports elements → match against the data
   * project's autocapture stats → push display-ready halos back into the page.
   * One loop for all views, started lazily with the first open.
   */
  private ensureOverlayLoop(): void {
    if (this.overlayLoopStarted) return;
    this.overlayLoopStarted = true;
    void (async () => {
      for await (const event of this.embeddedBrowser.events()) {
        if (event.type === "elements-reported") {
          this.scheduleOverlayRefresh(
            event.viewId,
            event.pageUrl,
            event.elements,
          );
        } else if (event.type === "view-destroyed") {
          this.dataProjectByView.delete(event.viewId);
          this.statsByView.delete(event.viewId);
        }
      }
    })().catch((error) => {
      this.overlayLoopStarted = false;
      this.log.warn("overlay loop stopped", { error });
    });
  }

  private scheduleOverlayRefresh(
    viewId: string,
    pageUrl: string,
    elements: unknown,
  ): void {
    const pending = this.overlayTimers.get(viewId);
    if (pending) clearTimeout(pending);
    this.overlayTimers.set(
      viewId,
      setTimeout(() => {
        this.overlayTimers.delete(viewId);
        void this.refreshOverlay(viewId, pageUrl, elements).catch((error) => {
          this.log.warn("overlay refresh failed", { viewId, error });
        });
      }, OVERLAY_DEBOUNCE_MS),
    );
  }

  private async refreshOverlay(
    viewId: string,
    pageUrl: string,
    rawElements: unknown,
  ): Promise<void> {
    const parsed = reportedElementsSchema.safeParse(rawElements);
    if (!parsed.success || parsed.data.length === 0) return;

    let pathname: string;
    try {
      pathname = new URL(pageUrl).pathname;
    } catch {
      return;
    }

    const projectId =
      this.dataProjectByView.get(viewId) ??
      this.authService.getState().currentProjectId;
    if (projectId == null) return;

    const rows = await this.fetchElementStats(projectId, pathname);
    const matched = matchElementStats(parsed.data, rows);
    this.statsByView.set(viewId, matched);
    this.embeddedBrowser.pushOverlayData({
      viewId,
      items: buildOverlayItems(matched, { maxItems: OVERLAY_MAX_ITEMS }),
    });
  }

  private async fetchElementStats(
    projectId: number,
    pathname: string,
  ): Promise<ReturnType<typeof shapeElementStatsResponse>> {
    const cacheKey = `${projectId}|${pathname}`;
    const cached = this.statsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < STATS_CACHE_TTL_MS) {
      return cached.rows;
    }
    const { apiHost } = await this.authService.getValidAccessToken();
    const response = await this.authService.authenticatedFetch(
      fetch,
      `${apiHost}/api/projects/${projectId}/elements/stats/?${elementStatsQuery(pathname)}`,
    );
    if (!response.ok) {
      throw new Error(`elements/stats failed (${response.status})`);
    }
    const rows = shapeElementStatsResponse(await response.json());
    this.statsCache.set(cacheKey, { at: Date.now(), rows });
    return rows;
  }

  async navigate(viewId: string, url: string): Promise<void> {
    await this.embeddedBrowser.navigate(viewId, assertHttpUrl(url));
  }

  goBack(viewId: string): void {
    this.embeddedBrowser.goBack(viewId);
  }

  goForward(viewId: string): void {
    this.embeddedBrowser.goForward(viewId);
  }

  reload(viewId: string): void {
    this.embeddedBrowser.reload(viewId);
  }

  setBounds(viewId: string, bounds: EmbeddedBrowserBounds): void {
    this.embeddedBrowser.setBounds(viewId, bounds);
  }

  setVisible(viewId: string, visible: boolean): void {
    this.embeddedBrowser.setVisible(viewId, visible);
  }

  async destroy(viewId: string): Promise<void> {
    await this.embeddedBrowser.destroy(viewId);
  }

  getPageState(viewId: string): EmbeddedBrowserPageState | null {
    return this.embeddedBrowser.getPageState(viewId);
  }

  setInspectMode(viewId: string, enabled: boolean): void {
    this.embeddedBrowser.setInspectMode(viewId, enabled);
  }

  events(signal?: AbortSignal): AsyncIterable<EmbeddedBrowserEvent> {
    return this.embeddedBrowser.events(signal);
  }

  /**
   * Candidate product origins for the current project: configured toolbar
   * `app_urls` first, then the hosts $pageview traffic actually reports.
   * Either source failing degrades to the other rather than throwing.
   */
  async suggestProductUrls(): Promise<ProductUrlSuggestion[]> {
    const [appUrls, hostRows] = await Promise.all([
      this.fetchAppUrls().catch((error) => {
        this.log.warn("app_urls fetch failed", { error });
        return [] as unknown[];
      }),
      runHogQLQuery(this.authService, buildHostsQuery(), {
        refresh: "blocking",
      })
        .then((r) => r.results)
        .catch((error) => {
          this.log.warn("pageview hosts query failed", { error });
          return [] as unknown[];
        }),
    ]);
    return shapeUrlSuggestions(appUrls, hostRows);
  }

  private async fetchAppUrls(): Promise<unknown[]> {
    const { apiHost } = await this.authService.getValidAccessToken();
    const projectId = this.authService.getState().currentProjectId;
    if (projectId == null) throw new Error("No PostHog project selected");
    const response = await this.authService.authenticatedFetch(
      fetch,
      `${apiHost}/api/projects/${projectId}/`,
    );
    if (!response.ok) {
      throw new Error(`Project fetch failed (${response.status})`);
    }
    const body = (await response.json()) as { app_urls?: unknown };
    return Array.isArray(body.app_urls) ? body.app_urls : [];
  }
}
