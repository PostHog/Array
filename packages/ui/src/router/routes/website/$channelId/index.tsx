import { WebsiteChannelHome } from "@posthog/ui/features/canvas/components/WebsiteChannelHome";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/$channelId/")({
  component: ChannelHomeRoute,
});

function ChannelHomeRoute() {
  const { channelId } = Route.useParams();
  return <WebsiteChannelHome channelId={channelId} />;
}
