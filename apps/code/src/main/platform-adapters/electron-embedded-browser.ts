import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserCreateOptions,
  EmbeddedBrowserEvent,
  EmbeddedBrowserOverlayPayload,
  EmbeddedBrowserPageState,
  IEmbeddedBrowser,
} from "@posthog/platform/embedded-browser";
import { MAIN_WINDOW_SERVICE } from "@posthog/platform/main-window";
import { TypedEventEmitter } from "@posthog/shared";
import { shell, WebContentsView } from "electron";
import { inject, injectable } from "inversify";
import { logger } from "../utils/logger";
import type { ElectronMainWindow } from "./electron-main-window";

const log = logger.scope("embedded-browser");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Events = { event: EmbeddedBrowserEvent };

function isWebUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A standard-Chrome user agent for the embedded product page. Identity
 * providers (notably Google) reject OAuth from anything that identifies as an
 * embedded webview — the default UA carries `Electron/…` and the app token,
 * which triggers `disallowed_useragent`. Stripping those tokens leaves the
 * plain Chrome UA this build actually is.
 */
function browserlikeUserAgent(defaultUserAgent: string): string {
  return defaultUserAgent
    .split(" ")
    .filter(
      (token) =>
        !token.startsWith("Electron/") &&
        !token.toLowerCase().includes("posthog"),
    )
    .join(" ");
}

/**
 * Desktop implementation of the Product View browser surface: one
 * `WebContentsView` per view id, attached to the single main window. The view
 * paints natively above the renderer, so the renderer only ever drives bounds
 * and visibility; element-anchored overlay UI renders inside the page via the
 * product-view preload (isolated world — the page can't see or spoof it).
 *
 * Security posture: fully sandboxed guest, its own cookie partition (the user
 * signs into THEIR product there; the app session at `persist:main` is never
 * shared), http(s)-only navigation, window.open denied (opens externally).
 */
@injectable()
export class ElectronEmbeddedBrowser
  extends TypedEventEmitter<Events>
  implements IEmbeddedBrowser
{
  private readonly views = new Map<string, WebContentsView>();

  constructor(
    @inject(MAIN_WINDOW_SERVICE)
    private readonly mainWindow: ElectronMainWindow,
  ) {
    super();
    this.setMaxListeners(0);
  }

  async create(options: EmbeddedBrowserCreateOptions): Promise<void> {
    const existing = this.views.get(options.viewId);
    if (existing) {
      // Re-opening a kept-alive view (tab switch back): re-glue and re-show it;
      // only navigate when the caller actually wants a different page.
      this.setBounds(options.viewId, options.bounds);
      existing.setVisible(true);
      if (existing.webContents.getURL() !== options.url) {
        await this.navigate(options.viewId, options.url);
      }
      this.emitPageState(options.viewId, existing);
      return;
    }

    const window = this.mainWindow.getBrowserWindow();
    if (!window) throw new Error("No main window to attach the view to");

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:product-view",
        preload: path.join(__dirname, "productViewPreload.js"),
      },
    });
    view.webContents.setUserAgent(
      browserlikeUserAgent(view.webContents.getUserAgent()),
    );
    this.views.set(options.viewId, view);
    this.wireEvents(options.viewId, view);
    window.contentView.addChildView(view);
    this.setBounds(options.viewId, options.bounds);

    try {
      await view.webContents.loadURL(options.url);
    } catch (error) {
      // Load failures (bad host, offline) keep the view alive — the page-state
      // stream reports isLoading=false and the user can retry from the URL bar.
      log.warn("initial load failed", { url: options.url, error });
    }
  }

  async navigate(viewId: string, url: string): Promise<void> {
    const view = this.mustGet(viewId);
    try {
      await view.webContents.loadURL(url);
    } catch (error) {
      log.warn("navigation failed", { url, error });
      this.emitPageState(viewId, view);
    }
  }

  goBack(viewId: string): void {
    this.views.get(viewId)?.webContents.navigationHistory.goBack();
  }

  goForward(viewId: string): void {
    this.views.get(viewId)?.webContents.navigationHistory.goForward();
  }

  reload(viewId: string): void {
    this.views.get(viewId)?.webContents.reload();
  }

  setBounds(viewId: string, bounds: EmbeddedBrowserBounds): void {
    const view = this.views.get(viewId);
    const window = this.mainWindow.getBrowserWindow();
    if (!view || !window) return;
    // The renderer reports CSS pixels; the window may be zoomed (Cmd+/-), so
    // scale to the host page's zoom factor to land on real window coordinates.
    const zoom = window.webContents.getZoomFactor();
    view.setBounds({
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.max(0, Math.round(bounds.width * zoom)),
      height: Math.max(0, Math.round(bounds.height * zoom)),
    });
  }

  setVisible(viewId: string, visible: boolean): void {
    this.views.get(viewId)?.setVisible(visible);
  }

  async destroy(viewId: string): Promise<void> {
    const view = this.views.get(viewId);
    if (!view) return;
    this.views.delete(viewId);
    const window = this.mainWindow.getBrowserWindow();
    window?.contentView.removeChildView(view);
    view.webContents.close();
    this.emit("event", { type: "view-destroyed", viewId });
  }

  getPageState(viewId: string): EmbeddedBrowserPageState | null {
    const view = this.views.get(viewId);
    return view ? this.pageState(viewId, view) : null;
  }

  setInspectMode(viewId: string, enabled: boolean): void {
    this.views
      .get(viewId)
      ?.webContents.send("product-view:set-inspect-mode", { enabled });
  }

  pushOverlayData(payload: EmbeddedBrowserOverlayPayload): void {
    this.views
      .get(payload.viewId)
      ?.webContents.send("product-view:overlay-data", {
        items: payload.items,
      });
  }

  events(signal?: AbortSignal): AsyncIterable<EmbeddedBrowserEvent> {
    return this.toIterable("event", { signal });
  }

  private mustGet(viewId: string): WebContentsView {
    const view = this.views.get(viewId);
    if (!view) throw new Error(`Unknown product view: ${viewId}`);
    return view;
  }

  private pageState(
    viewId: string,
    view: WebContentsView,
  ): EmbeddedBrowserPageState {
    const wc = view.webContents;
    return {
      viewId,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading(),
    };
  }

  private emitPageState(viewId: string, view: WebContentsView): void {
    this.emit("event", {
      type: "page-state",
      state: this.pageState(viewId, view),
    });
  }

  private wireEvents(viewId: string, view: WebContentsView): void {
    const wc = view.webContents;
    const push = () => this.emitPageState(viewId, view);
    wc.on("did-navigate", push);
    wc.on("did-navigate-in-page", push);
    wc.on("page-title-updated", push);
    wc.on("did-start-loading", push);
    wc.on("did-stop-loading", push);

    // The guest stays a plain web page: block non-web schemes.
    wc.on("will-navigate", (event, url) => {
      if (!isWebUrl(url)) event.preventDefault();
    });
    // Allow http(s) popups as real (sandboxed, preload-less) child windows on
    // the SAME cookie partition — popup-based SSO (Google sign-in) needs the
    // popup and the page to share a session, so bouncing it to the system
    // browser can never complete the login. Non-web schemes stay denied.
    wc.setWindowOpenHandler(({ url }) => {
      if (!isWebUrl(url)) return { action: "deny" };
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            partition: "persist:product-view",
          },
        },
      };
    });
    wc.on("did-create-window", (child) => {
      // Popups need the same identity-provider-friendly UA as the view.
      child.webContents.setUserAgent(
        browserlikeUserAgent(child.webContents.getUserAgent()),
      );
      child.webContents.on("will-navigate", (event, url) => {
        if (!isWebUrl(url)) event.preventDefault();
      });
      // No nested popups from a popup; open anything further externally.
      child.webContents.setWindowOpenHandler(({ url }) => {
        if (isWebUrl(url)) void shell.openExternal(url);
        return { action: "deny" };
      });
    });

    // Preload → host messages (inspector reports). Validated downstream by
    // the core service; here we only namespace-check and forward.
    wc.ipc.on("product-view:elements-reported", (_event, payload) => {
      this.emit("event", {
        type: "elements-reported",
        viewId,
        pageUrl: wc.getURL(),
        elements: Array.isArray(payload?.elements) ? payload.elements : [],
      });
    });
    wc.ipc.on("product-view:element-selected", (_event, payload) => {
      if (!payload?.element) return;
      this.emit("event", {
        type: "element-selected",
        viewId,
        pageUrl: wc.getURL(),
        element: payload.element,
      });
    });

    // Real interactions (ambient clicks, never blocked) — used to attribute
    // the network requests that follow to the element that triggered them.
    let lastInteraction: { selectorHash: string; at: number } | null = null;
    wc.ipc.on("product-view:interaction", (_event, payload) => {
      if (typeof payload?.selectorHash !== "string") return;
      lastInteraction = { selectorHash: payload.selectorHash, at: Date.now() };
    });

    this.attachNetworkCapture(viewId, view, () => {
      if (!lastInteraction) return null;
      return Date.now() - lastInteraction.at <= INTERACTION_ATTRIBUTION_MS
        ? lastInteraction.selectorHash
        : null;
    });
  }

  /**
   * Live network capture over CDP: request timing + the `traceparent` header
   * (frontend → backend trace correlation). Only fetch/XHR traffic is sampled,
   * and only these two fields ever leave the adapter — the page's cookies and
   * auth headers do not. Degrades to no capture when another debugger is
   * already attached (dev :9222, open devtools).
   */
  private attachNetworkCapture(
    viewId: string,
    view: WebContentsView,
    attributedSelectorHash: () => string | null,
  ): void {
    const wc = view.webContents;
    try {
      wc.debugger.attach("1.3");
      void wc.debugger.sendCommand("Network.enable");
    } catch (error) {
      log.warn("network capture unavailable", { viewId, error });
      return;
    }

    interface PendingRequest {
      url: string;
      method: string;
      startedAt: number;
      traceId: string | null;
      interactionSelectorHash: string | null;
      status: number | null;
    }
    const pending = new Map<string, PendingRequest>();

    wc.debugger.on("message", (_event, method, params) => {
      const p = params as {
        requestId?: string;
        type?: string;
        timestamp?: number;
        request?: {
          url?: string;
          method?: string;
          headers?: Record<string, string>;
        };
        response?: { status?: number };
      };
      const requestId = p.requestId;
      if (!requestId) return;

      if (method === "Network.requestWillBeSent") {
        if (p.type !== "XHR" && p.type !== "Fetch") return;
        if (pending.size > 500) pending.clear();
        const headers = p.request?.headers ?? {};
        const traceparent =
          headers.traceparent ?? headers.Traceparent ?? headers.TRACEPARENT;
        const traceId =
          typeof traceparent === "string"
            ? (traceparent.split("-")[1] ?? null)
            : null;
        pending.set(requestId, {
          url: p.request?.url ?? "",
          method: p.request?.method ?? "GET",
          startedAt: (p.timestamp ?? 0) * 1000,
          traceId,
          interactionSelectorHash: attributedSelectorHash(),
          status: null,
        });
      } else if (method === "Network.responseReceived") {
        const request = pending.get(requestId);
        if (request) request.status = p.response?.status ?? null;
      } else if (
        method === "Network.loadingFinished" ||
        method === "Network.loadingFailed"
      ) {
        const request = pending.get(requestId);
        if (!request) return;
        pending.delete(requestId);
        const endedAt = (p.timestamp ?? 0) * 1000;
        const duration =
          request.startedAt > 0 && endedAt > request.startedAt
            ? Math.round(endedAt - request.startedAt)
            : null;
        this.emit("event", {
          type: "network-sample",
          sample: {
            viewId,
            url: request.url,
            method: request.method,
            status: request.status,
            durationMs: duration,
            traceId: request.traceId,
            interactionSelectorHash: request.interactionSelectorHash,
            timestamp: Date.now(),
          },
        });
      }
    });

    wc.debugger.on("detach", (_event, reason) => {
      log.info("network capture detached", { viewId, reason });
    });
  }
}

/** How long after a click a network request is still attributed to it. */
const INTERACTION_ATTRIBUTION_MS = 2000;
