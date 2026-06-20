import type {
  BrowserFaviconEvent,
  BrowserNavigateEvent,
  BrowserOpenUrlEvent,
  BrowserTitleEvent,
  IBrowserService,
} from "@posthog/host-router/ports/browser";
import { MAIN_WINDOW_SERVICE } from "@posthog/platform/main-window";
import { TypedEventEmitter } from "@posthog/shared";
// biome-ignore lint/style/noRestrictedImports: Electron-only by design; see host-boundary-allowlist.json
import { clipboard, Menu, MenuItem, shell, WebContentsView } from "electron";
import { inject, injectable, preDestroy } from "inversify";
import type { ElectronMainWindow } from "../../platform-adapters/electron-main-window";
import { logger } from "../../utils/logger";
import { buildErrorPage } from "./errorPage";
import { buildNewTabPage } from "./newTabPage";

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

    // Replace blank new-tab sentinel with the Hedge Browser welcome page.
    const effectiveUrl =
      !url || url === "about:blank" ? buildNewTabPage() : url;

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

    // Seed the address bar immediately so it shows the target URL before any
    // navigation events fire (getURL() returns "" on a fresh WebContentsView).
    this.emit("navigate", {
      browserId,
      url: effectiveUrl,
      title: "",
      canGoBack: false,
      canGoForward: false,
      isLoading: true,
    });

    // Guards handlers that fire between browsers.delete() and webContents.close().
    const alive = () => this.browsers.has(browserId);

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

    // Route window.open() into the app as a new tab instead of a native window.
    view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (alive() && this.isSafeUrl(targetUrl)) {
        this.emit("openUrl", { url: targetUrl });
      }
      return { action: "deny" };
    });

    view.webContents.on("did-navigate", () => {
      if (alive()) this.emitNavigate(entry);
    });

    view.webContents.on("did-navigate-in-page", () => {
      if (alive()) this.emitNavigate(entry);
    });

    view.webContents.on("page-title-updated", (_e, title) => {
      if (alive()) this.emit("title", { browserId, title });
    });

    view.webContents.on("page-favicon-updated", (_e, favicons) => {
      if (alive())
        this.emit("favicon", { browserId, favicon: favicons[0] ?? null });
    });

    view.webContents.on("did-start-loading", () => {
      if (alive()) this.emitNavigate(entry);
    });

    view.webContents.on("did-stop-loading", () => {
      if (alive()) this.emitNavigate(entry);
    });

    // -3 is ABORTED (our own navigation lock or user pressing Stop) — skip to avoid flashing an error page.
    view.webContents.on(
      "did-fail-load",
      (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        if (errorCode === -3) return;
        if (!alive()) return;
        const errorPage = buildErrorPage(validatedURL);
        view.webContents.loadURL(errorPage).catch(() => {});
      },
    );

    view.webContents.on("context-menu", (_event, params) => {
      if (!alive()) return;
      const wc = entry.view.webContents;
      const items: MenuItem[] = [
        new MenuItem({
          label: "Back",
          enabled: wc.canGoBack(),
          click: () => wc.goBack(),
        }),
        new MenuItem({
          label: "Forward",
          enabled: wc.canGoForward(),
          click: () => wc.goForward(),
        }),
        new MenuItem({ label: "Reload", click: () => wc.reload() }),
        new MenuItem({ type: "separator" }),
      ];

      if (params.linkURL) {
        items.push(
          new MenuItem({
            label: "Open link in system browser",
            click: () => {
              shell.openExternal(params.linkURL).catch(() => {});
            },
          }),
          new MenuItem({
            label: "Copy link address",
            click: () => {
              clipboard.writeText(params.linkURL);
            },
          }),
          new MenuItem({ type: "separator" }),
        );
      } else {
        items.push(
          new MenuItem({
            label: "Open in system browser",
            click: () => {
              shell.openExternal(wc.getURL()).catch(() => {});
            },
          }),
          new MenuItem({
            label: "Copy page URL",
            click: () => {
              clipboard.writeText(wc.getURL());
            },
          }),
          new MenuItem({ type: "separator" }),
        );
      }

      items.push(
        new MenuItem({
          label: "Inspect element",
          click: () => {
            wc.inspectElement(params.x, params.y);
          },
        }),
      );

      const menu = Menu.buildFromTemplate(items);
      const mainWin = this.mainWindow.getBrowserWindow();
      if (mainWin) menu.popup({ window: mainWin });
    });

    view.webContents.loadURL(effectiveUrl).catch((err) => {
      log.warn("Failed to load URL", effectiveUrl, err);
    });
  }

  destroy(browserId: string): void {
    const entry = this.browsers.get(browserId);
    if (!entry) return;

    // Delete first so in-flight handlers (alive() check) become no-ops before teardown.
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
      // removeAllListeners before close() drops closure references immediately instead of waiting for GC.
      entry.view.webContents.removeAllListeners();
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

  stop(browserId: string): void {
    this.browsers.get(browserId)?.view.webContents.stop();
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
