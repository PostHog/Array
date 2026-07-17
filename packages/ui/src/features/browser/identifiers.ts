import type { ComponentType } from "react";

export interface BrowserViewHandle {
  loadURL(url: string): Promise<void>;
  reload(): void;
  stop(): void;
  goBack(): void;
  goForward(): void;
}

export interface BrowserViewNavigation {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserViewProps {
  initialUrl: string;
  onReady: (handle: BrowserViewHandle | null) => void;
  onNavigate: (navigation: BrowserViewNavigation) => void;
  onTitleChange: (title: string) => void;
  onLoadError: (message: string) => void;
  onLoadingChange: (isLoading: boolean) => void;
}

export type BrowserViewComponent = ComponentType<BrowserViewProps>;

export const BROWSER_VIEW_COMPONENT = Symbol.for(
  "posthog.ui.BrowserViewComponent",
);
