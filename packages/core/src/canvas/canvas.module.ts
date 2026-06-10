import { ContainerModule } from "inversify";
import { DashboardQueryService } from "./dashboardQueryService";
import { DashboardsService } from "./dashboardsService";
import { DASHBOARD_QUERY_SERVICE, DASHBOARDS_SERVICE } from "./identifiers";

// Host-agnostic canvas services (dashboards + their HogQL refresh). They only
// need AuthService + fetch, so they live in @posthog/core and any host (desktop,
// web, server) can bind them by loading this module.
export const canvasCoreModule = new ContainerModule(({ bind }) => {
  bind(DashboardQueryService).toSelf().inSingletonScope();
  bind(DASHBOARD_QUERY_SERVICE).toService(DashboardQueryService);

  bind(DashboardsService).toSelf().inSingletonScope();
  bind(DASHBOARDS_SERVICE).toService(DashboardsService);
});
