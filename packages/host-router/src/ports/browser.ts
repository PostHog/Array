export const BROWSER_SERVICE = Symbol.for("posthog.host.browser.service");

export interface BrowserNavigateEvent {
  browserId: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

export interface BrowserTitleEvent {
  browserId: string;
  title: string;
}

export interface BrowserFaviconEvent {
  browserId: string;
  favicon: string | null;
}

export interface BrowserOpenUrlEvent {
  url: string;
}

export interface IBrowserService {
  create(browserId: string, url: string): void;
  destroy(browserId: string): void;
  navigate(browserId: string, url: string): void;
  setBounds(
    browserId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void;
  setVisible(browserId: string, visible: boolean): void;
  goBack(browserId: string): void;
  goForward(browserId: string): void;
  reload(browserId: string): void;
  getState(browserId: string): {
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
    isLoading: boolean;
  } | null;
  on(event: "navigate", listener: (data: BrowserNavigateEvent) => void): void;
  on(event: "title", listener: (data: BrowserTitleEvent) => void): void;
  on(event: "favicon", listener: (data: BrowserFaviconEvent) => void): void;
  on(event: "openUrl", listener: (data: BrowserOpenUrlEvent) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}
