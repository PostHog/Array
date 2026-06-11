import { ContainerModule } from "inversify";
import { CanvasTemplatesService } from "./canvasTemplatesService";
import { DashboardQueryService } from "./dashboardQueryService";
import { DashboardsService } from "./dashboardsService";
import {
  CANVAS_TEMPLATES_SERVICE,
  DASHBOARD_QUERY_SERVICE,
  DASHBOARDS_SERVICE,
} from "./identifiers";

// Host-agnostic canvas services (dashboards + their HogQL refresh). They only
// need AuthService + fetch, so they live in @posthog/core and any host (desktop,
// web, server) can bind them by loading this module.
export const canvasCoreModule = new ContainerModule(({ bind }) => {
  bind(DashboardQueryService).toSelf().inSingletonScope();
  bind(DASHBOARD_QUERY_SERVICE).toService(DashboardQueryService);

  bind(DashboardsService).toSelf().inSingletonScope();
  bind(DASHBOARDS_SERVICE).toService(DashboardsService);

  // Canvas templates: host-agnostic (pure prompt strings), no deps. The
  // host-router canvas-templates router and CanvasGenService resolve it by token.
  bind(CanvasTemplatesService).toSelf().inSingletonScope();
  bind(CANVAS_TEMPLATES_SERVICE).toService(CanvasTemplatesService);
});
