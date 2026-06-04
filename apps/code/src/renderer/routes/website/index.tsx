import { DEFAULT_DASHBOARD_ID } from "@features/canvas/dashboards";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/website/")({
  beforeLoad: () => {
    throw redirect({
      to: "/website/dashboards/$dashboardId",
      params: { dashboardId: DEFAULT_DASHBOARD_ID },
    });
  },
});
