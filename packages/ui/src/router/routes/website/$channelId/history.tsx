import { WebsiteChannelHistory } from "@posthog/ui/features/canvas/components/WebsiteChannelHistory";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/$channelId/history")({
  component: ChannelHistoryRoute,
});

function ChannelHistoryRoute() {
  const { channelId } = Route.useParams();
  return <WebsiteChannelHistory channelId={channelId} />;
}
