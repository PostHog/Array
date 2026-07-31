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
  buildHostsQuery,
  type ProductUrlSuggestion,
  shapeUrlSuggestions,
} from "./productSuggestions";

export interface IProductViewService {
  open(input: {
    viewId: string;
    url: string;
    bounds: EmbeddedBrowserBounds;
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
@injectable()
export class ProductViewService implements IProductViewService {
  private readonly log: ScopedLogger;

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
  }): Promise<void> {
    const url = assertHttpUrl(input.url);
    await this.embeddedBrowser.create({ ...input, url });
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
