import { WebsiteDashboard } from "@posthog/ui/features/canvas/components/WebsiteDashboard";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/website/$channelId/dashboards/$dashboardId",
)({
  component: DashboardRoute,
});

function DashboardRoute() {
  const { dashboardId } = Route.useParams();
  return <WebsiteDashboard dashboardId={dashboardId} />;
}
