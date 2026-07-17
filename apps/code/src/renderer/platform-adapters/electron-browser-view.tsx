import { BROWSER_WEBVIEW_PARTITION } from "@posthog/shared/constants";
import type {
  BrowserViewHandle,
  BrowserViewProps,
} from "@posthog/ui/features/browser/identifiers";
import { useEffect, useRef } from "react";

interface ElectronWebviewElement extends HTMLElement, BrowserViewHandle {
  getURL(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

type WebviewNavigateEvent = Event & { url: string; isMainFrame?: boolean };
type WebviewTitleEvent = Event & { title: string };
type WebviewFailLoadEvent = Event & {
  errorCode: number;
  errorDescription: string;
  isMainFrame: boolean;
};

export function ElectronBrowserView({
  initialUrl,
  onReady,
  onNavigate,
  onTitleChange,
  onLoadError,
  onLoadingChange,
}: BrowserViewProps) {
  const webviewRef = useRef<ElectronWebviewElement | null>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleNavigate = (event: Event) => {
      const navigation = event as WebviewNavigateEvent;
      if (navigation.isMainFrame === false) return;
      onNavigate({
        url: navigation.url ?? webview.getURL(),
        canGoBack: webview.canGoBack(),
        canGoForward: webview.canGoForward(),
      });
    };
    const handleTitle = (event: Event) => {
      onTitleChange((event as WebviewTitleEvent).title);
    };
    const handleFailLoad = (event: Event) => {
      const failure = event as WebviewFailLoadEvent;
      if (failure.isMainFrame === false || failure.errorCode === -3) return;
      onLoadError(failure.errorDescription || "Failed to load page");
    };
    const handleStartLoading = () => onLoadingChange(true);
    const handleStopLoading = () => onLoadingChange(false);

    onReady(webview);
    webview.addEventListener("did-navigate", handleNavigate);
    webview.addEventListener("did-navigate-in-page", handleNavigate);
    webview.addEventListener("page-title-updated", handleTitle);
    webview.addEventListener("did-fail-load", handleFailLoad);
    webview.addEventListener("did-start-loading", handleStartLoading);
    webview.addEventListener("did-stop-loading", handleStopLoading);

    return () => {
      onReady(null);
      webview.removeEventListener("did-navigate", handleNavigate);
      webview.removeEventListener("did-navigate-in-page", handleNavigate);
      webview.removeEventListener("page-title-updated", handleTitle);
      webview.removeEventListener("did-fail-load", handleFailLoad);
      webview.removeEventListener("did-start-loading", handleStartLoading);
      webview.removeEventListener("did-stop-loading", handleStopLoading);
    };
  }, [onLoadError, onLoadingChange, onNavigate, onReady, onTitleChange]);

  return (
    <webview
      ref={webviewRef}
      src={initialUrl}
      partition={BROWSER_WEBVIEW_PARTITION}
      style={{ height: "100%", width: "100%" }}
    />
  );
}
