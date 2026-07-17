import type {
  BrowserViewHandle,
  BrowserViewProps,
} from "@posthog/ui/features/browser/identifiers";
import { trpcClient } from "@renderer/trpc/client";
import { BROWSER_WEBVIEW_PARTITION } from "@shared/browser-view";
import { useEffect, useRef, useState } from "react";

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
  const [hostEnabled, setHostEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    trpcClient.browserView.setEnabled
      .mutate({ enabled: true })
      .then(() => {
        if (active) setHostEnabled(true);
      })
      .catch(() => {
        if (active) onLoadError("Browser view is unavailable");
      });
    return () => {
      active = false;
    };
  }, [onLoadError]);

  useEffect(() => {
    if (!hostEnabled) return;
    const webview = webviewRef.current;
    if (!webview) return;

    let ready = false;
    const readyTimeout = window.setTimeout(() => {
      if (ready) return;
      onReady(null);
      onLoadError("Browser view failed to attach");
    }, 10_000);
    const handleReady = () => {
      if (ready) return;
      ready = true;
      window.clearTimeout(readyTimeout);
      onReady(webview);
    };
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

    webview.addEventListener("dom-ready", handleReady);
    webview.addEventListener("did-navigate", handleNavigate);
    webview.addEventListener("did-navigate-in-page", handleNavigate);
    webview.addEventListener("page-title-updated", handleTitle);
    webview.addEventListener("did-fail-load", handleFailLoad);
    webview.addEventListener("did-start-loading", handleStartLoading);
    webview.addEventListener("did-stop-loading", handleStopLoading);

    return () => {
      window.clearTimeout(readyTimeout);
      onReady(null);
      webview.removeEventListener("dom-ready", handleReady);
      webview.removeEventListener("did-navigate", handleNavigate);
      webview.removeEventListener("did-navigate-in-page", handleNavigate);
      webview.removeEventListener("page-title-updated", handleTitle);
      webview.removeEventListener("did-fail-load", handleFailLoad);
      webview.removeEventListener("did-start-loading", handleStartLoading);
      webview.removeEventListener("did-stop-loading", handleStopLoading);
    };
  }, [
    hostEnabled,
    onLoadError,
    onLoadingChange,
    onNavigate,
    onReady,
    onTitleChange,
  ]);

  if (!hostEnabled) return null;

  return (
    <webview
      ref={webviewRef}
      src={initialUrl}
      partition={BROWSER_WEBVIEW_PARTITION}
      style={{ height: "100%", width: "100%" }}
    />
  );
}
