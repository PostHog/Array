import { WebsiteChannelArtifacts } from "@posthog/ui/features/canvas/components/WebsiteChannelArtifacts";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/$channelId/artifacts")({
  component: ChannelArtifactsRoute,
});

function ChannelArtifactsRoute() {
  const { channelId } = Route.useParams();
  return <WebsiteChannelArtifacts channelId={channelId} />;
}
