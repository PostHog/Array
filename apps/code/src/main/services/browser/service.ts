import type {
  BrowserFaviconEvent,
  BrowserNavigateEvent,
  BrowserOpenUrlEvent,
  BrowserTitleEvent,
  IBrowserService,
} from "@posthog/host-router/ports/browser";
import { MAIN_WINDOW_SERVICE } from "@posthog/platform/main-window";
import { TypedEventEmitter } from "@posthog/shared";
import { WebContentsView } from "electron";
import { inject, injectable, preDestroy } from "inversify";
import type { ElectronMainWindow } from "../../platform-adapters/electron-main-window";
import { logger } from "../../utils/logger";
import { buildErrorPage } from "./errorPage";

const log = logger.scope("browser-service");

type BrowserServiceEvents = {
  navigate: BrowserNavigateEvent;
  title: BrowserTitleEvent;
  favicon: BrowserFaviconEvent;
  openUrl: BrowserOpenUrlEvent;
};

interface BrowserEntry {
  view: WebContentsView;
  browserId: string;
}

@injectable()
export class BrowserService
  extends TypedEventEmitter<BrowserServiceEvents>
  implements IBrowserService
{
  private browsers = new Map<string, BrowserEntry>();

  constructor(
    @inject(MAIN_WINDOW_SERVICE)
    private readonly mainWindow: ElectronMainWindow,
  ) {
    super();
  }

  private static readonly SAFE_PROTOCOLS = new Set(["https:", "http:"]);

  private isSafeUrl(url: string): boolean {
    try {
      const { protocol } = new URL(url);
      return BrowserService.SAFE_PROTOCOLS.has(protocol);
    } catch {
      return false;
    }
  }

  create(browserId: string, url: string): void {
    if (this.browsers.has(browserId)) return;

    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Shared persistent session so cookies/logins persist across tabs.
        partition: "persist:browser",
      },
    });

    const entry: BrowserEntry = { view, browserId };
    this.browsers.set(browserId, entry);

    const win = this.mainWindow.getBrowserWindow();
    if (win) {
      win.contentView.addChildView(view);
    }

    // Block navigation to anything other than http/https.
    view.webContents.on("will-navigate", (event, targetUrl) => {
      if (!this.isSafeUrl(targetUrl)) {
        event.preventDefault();
        log.warn("Blocked navigation to unsafe URL", targetUrl);
      }
    });

    // Prevent deep-link hijacking via frame-level navigations.
    view.webContents.on("will-frame-navigate", (event) => {
      if (!this.isSafeUrl(event.url)) {
        event.preventDefault();
        log.warn("Blocked frame navigation to unsafe URL", event.url);
      }
    });

    // Open window.open() calls as new browser tabs in the app instead of
    // spawning an uncontrolled native window.
    view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (this.isSafeUrl(targetUrl)) {
        this.emit("openUrl", { url: targetUrl });
      }
      return { action: "deny" };
    });

    view.webContents.on("did-navigate", () => {
      this.emitNavigate(entry);
    });

    view.webContents.on("did-navigate-in-page", () => {
      this.emitNavigate(entry);
    });

    view.webContents.on("page-title-updated", (_e, title) => {
      this.emit("title", { browserId, title });
    });

    view.webContents.on("page-favicon-updated", (_e, favicons) => {
      this.emit("favicon", {
        browserId,
        favicon: favicons[0] ?? null,
      });
    });

    view.webContents.on("did-start-loading", () => {
      this.emitNavigate(entry);
    });

    view.webContents.on("did-stop-loading", () => {
      this.emitNavigate(entry);
    });

    // Show a branded error page when a URL fails to load (DNS errors, timeouts, etc.).
    // Error codes < 0 are Chromium net errors; -3 is ABORTED (e.g. caused by our own
    // navigation lock, or the user pressing Stop) — skip those to avoid flashing the
    // error page during normal navigation.
    view.webContents.on(
      "did-fail-load",
      (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        if (errorCode === -3) return;
        const errorPage = buildErrorPage(validatedURL);
        view.webContents.loadURL(errorPage).catch(() => {});
      },
    );

    if (url && url !== "about:blank") {
      view.webContents.loadURL(url).catch((err) => {
        log.warn("Failed to load URL", url, err);
      });
    }
  }

  destroy(browserId: string): void {
    const entry = this.browsers.get(browserId);
    if (!entry) return;

    this.browsers.delete(browserId);

    const win = this.mainWindow.getBrowserWindow();
    if (win) {
      try {
        win.contentView.removeChildView(entry.view);
      } catch {
        // view may already be detached
      }
    }

    try {
      entry.view.webContents.close();
    } catch {
      // already closed
    }
  }

  navigate(browserId: string, url: string): void {
    const entry = this.browsers.get(browserId);
    if (!entry) return;
    entry.view.webContents.loadURL(url).catch((err) => {
      log.warn("Failed to navigate", url, err);
    });
  }

  setBounds(
    browserId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const entry = this.browsers.get(browserId);
    if (!entry) return;
    entry.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
  }

  setVisible(browserId: string, visible: boolean): void {
    const entry = this.browsers.get(browserId);
    if (!entry) return;
    entry.view.setVisible(visible);
  }

  goBack(browserId: string): void {
    this.browsers.get(browserId)?.view.webContents.goBack();
  }

  goForward(browserId: string): void {
    this.browsers.get(browserId)?.view.webContents.goForward();
  }

  reload(browserId: string): void {
    this.browsers.get(browserId)?.view.webContents.reload();
  }

  getState(browserId: string): {
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
    isLoading: boolean;
  } | null {
    const entry = this.browsers.get(browserId);
    if (!entry) return null;
    const wc = entry.view.webContents;
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isLoading: wc.isLoading(),
    };
  }

  private emitNavigate(entry: BrowserEntry): void {
    const wc = entry.view.webContents;
    this.emit("navigate", {
      browserId: entry.browserId,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isLoading: wc.isLoading(),
    });
  }

  @preDestroy()
  dispose(): void {
    for (const [id] of this.browsers) {
      this.destroy(id);
    }
  }
}
