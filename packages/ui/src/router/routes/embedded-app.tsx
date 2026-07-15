import { PostHogApp } from "@posthog/ui/features/embedded-app/EmbeddedAppView";
import { createFileRoute } from "@tanstack/react-router";

/** EXPERIMENT (embedded webapp): dev route hosting the iframe'd PostHog app. */
export const Route = createFileRoute("/embedded-app")({
  component: EmbeddedAppRoute,
});

function EmbeddedAppRoute() {
  return <PostHogApp url="/notebooks" />;
}
