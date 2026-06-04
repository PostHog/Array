import { WebsiteDashboardsIndex } from "@features/canvas/components/WebsiteDashboardsIndex";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/website/")({
  component: WebsiteDashboardsIndex,
});
