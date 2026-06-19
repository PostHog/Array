import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import { BrowserToolbar } from "@posthog/ui/features/browser/BrowserToolbar";
import { useBrowserStore } from "@posthog/ui/features/browser/browserStore";
import { usePanelLayoutState } from "@posthog/ui/features/panels/hooks/usePanelLayoutHooks";
import { Flex } from "@radix-ui/themes";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const boundsRafRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const visibleRef = useRef(false);
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
      client.browser.destroy.mutate({ browserId });
      removeBrowser(browserId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncBounds = useCallback(() => {
    if (!contentRef.current || !mountedRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    client.browser.setBounds.mutate({
      browserId,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
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
      client.browser.setVisible.mutate({ browserId, visible });
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
