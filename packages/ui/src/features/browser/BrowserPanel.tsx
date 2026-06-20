import { findTabInTree } from "@posthog/core/panels/panelTree";
import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import { ANALYTICS_EVENTS } from "@posthog/shared";
import { BrowserToolbar } from "@posthog/ui/features/browser/BrowserToolbar";
import { useBrowserStore } from "@posthog/ui/features/browser/browserStore";
import { usePanelLayoutState } from "@posthog/ui/features/panels/hooks/usePanelLayoutHooks";
import { usePanelLayoutStore } from "@posthog/ui/features/panels/panelLayoutStore";
import { Flex } from "@radix-ui/themes";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "../../shell/analytics";

interface BrowserPanelProps {
  browserId: string;
  initialUrl: string;
  taskId: string;
  panelId: string;
}

export function BrowserPanel({
  browserId,
  initialUrl,
  taskId,
  panelId,
}: BrowserPanelProps) {
  const client = useHostTRPCClient();
  const trpc = useHostTRPC();
  const contentRef = useRef<HTMLDivElement>(null);
  const setBrowserState = useBrowserStore((s) => s.setBrowserState);
  const removeBrowser = useBrowserStore((s) => s.removeBrowser);
  const { addBrowserTab, updateTabLabel } = usePanelLayoutState(taskId);
  const updateBrowserTabUrl = usePanelLayoutStore((s) => s.updateBrowserTabUrl);
  const boundsRafRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const visibleRef = useRef(false);
  const lastBoundsRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const lastVisibleRef = useRef<boolean | null>(null);
  const [viewReady, setViewReady] = useState(false);

  // Create the WebContentsView on mount, destroy on unmount.
  useEffect(() => {
    mountedRef.current = true;
    client.browser.create
      .mutate({ browserId, url: initialUrl })
      .then(() => {
        if (!mountedRef.current) return;
        setViewReady(true);
      })
      .catch(() => {});

    return () => {
      mountedRef.current = false;
      if (boundsRafRef.current !== null) {
        cancelAnimationFrame(boundsRafRef.current);
      }
      // Skip destroy if the tab was moved to another panel — create() will be
      // called by the new BrowserPanel but the guard (browsers.has) returns early,
      // preserving the WebContentsView without a reload.
      const layout = usePanelLayoutStore.getState().getLayout(taskId);
      const tabMoved = layout
        ? findTabInTree(layout.panelTree, browserId) !== null
        : false;
      if (!tabMoved) {
        client.browser.destroy.mutate({ browserId });
        removeBrowser(browserId);
      } else {
        // Hide the native view so it doesn't float over the UI during re-renders or HMR.
        client.browser.setVisible.mutate({ browserId, visible: false });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncBounds = useCallback(() => {
    if (!contentRef.current || !mountedRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.round(rect.left);
    const y = Math.round(rect.top);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const prev = lastBoundsRef.current;
    if (
      prev &&
      prev.x === x &&
      prev.y === y &&
      prev.width === width &&
      prev.height === height
    )
      return;
    lastBoundsRef.current = { x, y, width, height };
    client.browser.setBounds.mutate({ browserId, x, y, width, height });
  }, [browserId, client]);

  const scheduleSyncBounds = useCallback(() => {
    if (boundsRafRef.current !== null) return;
    boundsRafRef.current = requestAnimationFrame(() => {
      boundsRafRef.current = null;
      syncBounds();
    });
  }, [syncBounds]);

  // Once the main-process view exists, sync its position and visibility.
  useEffect(() => {
    if (!viewReady) return;
    const visible = visibleRef.current;
    lastVisibleRef.current = visible;
    client.browser.setVisible.mutate({ browserId, visible });
    if (visible) syncBounds();
  }, [viewReady, browserId, client, syncBounds]);

  // Detect tab show/hide via IntersectionObserver — drives setVisible + bounds sync.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      const visible = entry?.isIntersecting ?? false;
      visibleRef.current = visible;
      if (!viewReady) return;
      if (lastVisibleRef.current !== visible) {
        lastVisibleRef.current = visible;
        client.browser.setVisible.mutate({ browserId, visible });
      }
      if (visible) scheduleSyncBounds();
    });

    intersectionObserver.observe(el);
    return () => intersectionObserver.disconnect();
  }, [viewReady, browserId, client, scheduleSyncBounds]);

  // Sync bounds on content area resize.
  useEffect(() => {
    if (!viewReady) return;
    const el = contentRef.current;
    if (!el) return;
    const resizeObserver = new ResizeObserver(scheduleSyncBounds);
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, [viewReady, scheduleSyncBounds]);

  // Sync on window resize (catches panel layout shifts not detected by ResizeObserver).
  useEffect(() => {
    if (!viewReady) return;
    window.addEventListener("resize", scheduleSyncBounds);
    return () => window.removeEventListener("resize", scheduleSyncBounds);
  }, [viewReady, scheduleSyncBounds]);

  useSubscription(
    trpc.browser.onNavigate.subscriptionOptions(
      { browserId },
      {
        onData: (data) => {
          setBrowserState(browserId, {
            url: data.url,
            title: data.title,
            canGoBack: data.canGoBack,
            canGoForward: data.canGoForward,
            isLoading: data.isLoading,
          });
          if (!data.isLoading && data.url && !data.url.startsWith("data:")) {
            updateBrowserTabUrl(taskId, browserId, data.url);
          }
        },
      },
    ),
  );

  useSubscription(
    trpc.browser.onTitle.subscriptionOptions(
      { browserId },
      {
        onData: (data) => {
          setBrowserState(browserId, { title: data.title });
          if (data.title) updateTabLabel(taskId, browserId, data.title);
        },
      },
    ),
  );

  useSubscription(
    trpc.browser.onFavicon.subscriptionOptions(
      { browserId },
      {
        onData: (data) => {
          setBrowserState(browserId, { favicon: data.favicon });
        },
      },
    ),
  );

  // Open window.open() requests as new browser tabs in the same panel.
  useSubscription(
    trpc.browser.onOpenUrl.subscriptionOptions(undefined, {
      onData: (data) => {
        addBrowserTab(taskId, panelId, data.url);
        track(ANALYTICS_EVENTS.BROWSER_TAB_OPENED, {
          source: "window_open",
          has_initial_url: true,
        });
      },
    }),
  );

  return (
    <Flex direction="column" style={{ height: "100%", overflow: "hidden" }}>
      <BrowserToolbar browserId={browserId} />
      {/* Placeholder div — WebContentsView overlays this exact rect. */}
      <div ref={contentRef} style={{ flex: 1 }} />
    </Flex>
  );
}
