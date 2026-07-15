import { PostHogApp } from "@posthog/ui/features/embedded-app/EmbeddedAppView";
import { createFileRoute } from "@tanstack/react-router";

/**
 * EXPERIMENT (embedded webapp): route hosting the iframe'd PostHog app.
 * `path` is the webapp path this surface starts at; each distinct path is its
 * own browser tab (identity is encoded into the tab's appView string, see
 * BrowserTabStrip).
 */
export const Route = createFileRoute("/embedded-app")({
  validateSearch: (search: Record<string, unknown>): { path?: string } => ({
    path: typeof search.path === "string" ? search.path : undefined,
  }),
  component: EmbeddedAppRoute,
});

function EmbeddedAppRoute() {
  const { path } = Route.useSearch();
  const url = path ?? "/notebooks";
  // Key by path so switching between two embedded tabs remounts the surface
  // cleanly instead of reusing a stale iframe/bridge pair.
  return <PostHogApp key={url} url={url} />;
}
