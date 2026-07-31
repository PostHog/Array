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

    // The guest stays a plain web page: block non-web schemes and keep
    // popups/new windows in the system browser rather than spawning windows.
    wc.on("will-navigate", (event, url) => {
      if (!isWebUrl(url)) event.preventDefault();
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
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
  }
}
