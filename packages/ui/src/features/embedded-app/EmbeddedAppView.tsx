import { useHostTRPC } from "@posthog/host-router/react";
import { Button } from "@posthog/quill";
import { useOpenEmbeddedAppTab } from "@posthog/ui/features/browser-tabs/useOpenEmbeddedAppTab";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThemeStore } from "../../shell/themeStore";
import { normalizeEmbedPath } from "./embeddedAppTab";

/**
 * EXPERIMENT (embedded webapp): renders the real PostHog webapp in an iframe.
 *
 * The iframe points at a local main-process proxy that serves the webapp
 * shell and forwards /api to PostHog cloud with the app's OAuth token, so
 * the webapp sees a same-origin cookie-less API. A postMessage bridge keeps
 * navigation and theme in sync, and forwards new-tab intents (window.open /
 * target="_blank" inside the webapp) so they open as host browser tabs
 * (see frontend/src/embed/bridge.ts in the posthog repo).
 */

const FROM_EMBED = "posthog-embed";
const FROM_HOST = "posthog-embed-host";

const QUICK_LINKS: Array<{ label: string; path: string }> = [
  { label: "Notebooks", path: "/notebooks" },
  { label: "Feature flags", path: "/feature_flags" },
  { label: "Dashboards", path: "/dashboard" },
  { label: "Activity", path: "/activity/explore" },
];

interface PostHogAppProps {
  /** Initial webapp path, e.g. "/notebooks" */
  url: string;
}

export function PostHogApp({ url: initialPath }: PostHogAppProps) {
  const trpc = useHostTRPC();
  const { data, error, isLoading } = useQuery(
    trpc.embeddedApp.getUrl.queryOptions(undefined, {
      staleTime: Number.POSITIVE_INFINITY,
      retry: 1,
    }),
  );
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const openEmbeddedAppTab = useOpenEmbeddedAppTab();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [embedRoute, setEmbedRoute] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Compute the iframe src once per proxy URL: theme changes and navigation
  // afterwards go over the bridge instead of reloading the iframe.
  const initialThemeRef = useRef(isDarkMode ? "dark" : "light");
  const iframeSrc = useMemo(() => {
    if (!data?.url) return null;
    return `${data.url}${initialPath}?__posthog_embed_theme=${initialThemeRef.current}`;
  }, [data?.url, initialPath]);

  const postToEmbed = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: FROM_HOST, ...message },
      "*",
    );
  }, []);

  // Open a webapp path as a NEW host browser tab (or focus the tab already
  // at that path — tab identity encodes the path).
  const openHostTab = useCallback(
    (path: string) => {
      openEmbeddedAppTab(normalizeEmbedPath(path));
    },
    [openEmbeddedAppTab],
  );
  const openHostTabRef = useRef(openHostTab);
  openHostTabRef.current = openHostTab;

  // Read inside the message handler without re-subscribing on theme changes.
  const isDarkModeRef = useRef(isDarkMode);
  isDarkModeRef.current = isDarkMode;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (
        !data ||
        typeof data !== "object" ||
        (data as Record<string, unknown>).source !== FROM_EMBED ||
        event.source !== iframeRef.current?.contentWindow
      ) {
        return;
      }
      const message = data as { type?: string; url?: unknown };
      if (message.type === "ready") {
        setReady(true);
        if (typeof message.url === "string") setEmbedRoute(message.url);
        // Re-sync theme on every ready — the iframe may have reloaded and
        // `ready` state (already true) won't re-run the theme effect.
        postToEmbed({
          type: "setTheme",
          theme: isDarkModeRef.current ? "dark" : "light",
        });
      } else if (
        message.type === "routeChanged" &&
        typeof message.url === "string"
      ) {
        setEmbedRoute(message.url);
      } else if (
        message.type === "openTab" &&
        typeof message.url === "string"
      ) {
        // window.open / target="_blank" inside the webapp: open a host tab.
        openHostTabRef.current(message.url);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postToEmbed]);

  // Host theme wins: push it whenever it changes (and once the embed is ready).
  useEffect(() => {
    if (ready) {
      postToEmbed({ type: "setTheme", theme: isDarkMode ? "dark" : "light" });
    }
  }, [ready, isDarkMode, postToEmbed]);

  const navigate = useCallback(
    (path: string) => postToEmbed({ type: "navigate", url: path }),
    [postToEmbed],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm opacity-70">
        Starting embedded PostHog…
      </div>
    );
  }
  if (error || !iframeSrc) {
    return (
      <div className="flex h-full items-center justify-center text-sm opacity-70">
        Could not start the embedded PostHog proxy
        {error ? `: ${String(error)}` : ""}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-2 py-1">
        {QUICK_LINKS.map((link) => (
          <Button
            key={link.path}
            variant="outline"
            size="sm"
            onClick={() => navigate(link.path)}
          >
            {link.label}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          title="Open the current page in a new tab"
          onClick={() => openHostTab(embedRoute ?? initialPath)}
        >
          <Plus size={14} />
          New tab
        </Button>
        <span className="ml-auto truncate font-mono text-xs opacity-60">
          {ready ? (embedRoute ?? "") : "connecting…"}
        </span>
      </div>
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        title="PostHog"
        className="min-h-0 w-full flex-1 border-0"
      />
    </div>
  );
}
