import { WebsiteChannelInbox } from "@posthog/ui/features/canvas/components/WebsiteChannelInbox";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/$channelId/inbox")({
  component: ChannelInboxRoute,
});

function ChannelInboxRoute() {
  const { channelId } = Route.useParams();
  return <WebsiteChannelInbox channelId={channelId} />;
}
