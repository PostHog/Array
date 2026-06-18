import { WebsiteDashboardsIndex } from "@posthog/ui/features/canvas/components/WebsiteDashboardsIndex";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/$channelId/")({
  component: ChannelDashboardsRoute,
});

function ChannelDashboardsRoute() {
  const { channelId } = Route.useParams();
  return <WebsiteDashboardsIndex channelId={channelId} />;
}
