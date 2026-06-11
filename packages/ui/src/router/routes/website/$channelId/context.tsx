import { WebsiteContext } from "@posthog/ui/features/canvas/components/WebsiteContext";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/$channelId/context")({
  component: ContextRoute,
});

function ContextRoute() {
  const { channelId } = Route.useParams();
  return <WebsiteContext channelId={channelId} />;
}
