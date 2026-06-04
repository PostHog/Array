import { WebsiteSettings } from "@features/canvas/components/WebsiteSettings";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/$channelId/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const { channelId } = Route.useParams();
  return <WebsiteSettings channelId={channelId} />;
}
