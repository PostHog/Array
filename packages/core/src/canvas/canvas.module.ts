import { ContainerModule } from "inversify";
import { ChannelTasksService } from "./channelTasksService";
import { DashboardQueryService } from "./dashboardQueryService";
import { DashboardsService } from "./dashboardsService";
import { DESKTOP_FS_CLIENT, DesktopFsClient } from "./desktopFsClient";
import {
  CHANNEL_TASKS_SERVICE,
  DASHBOARD_QUERY_SERVICE,
  DASHBOARDS_SERVICE,
} from "./identifiers";

// Host-agnostic canvas services (dashboards + their HogQL refresh). They only
// need AuthService + fetch, so they live in @posthog/core and any host (desktop,
// web, server) can bind them by loading this module.
export const canvasCoreModule = new ContainerModule(({ bind }) => {
  bind(DesktopFsClient).toSelf().inSingletonScope();
  bind(DESKTOP_FS_CLIENT).toService(DesktopFsClient);

  bind(DashboardQueryService).toSelf().inSingletonScope();
  bind(DASHBOARD_QUERY_SERVICE).toService(DashboardQueryService);

  bind(DashboardsService).toSelf().inSingletonScope();
  bind(DASHBOARDS_SERVICE).toService(DashboardsService);

  bind(ChannelTasksService).toSelf().inSingletonScope();
  bind(CHANNEL_TASKS_SERVICE).toService(ChannelTasksService);
});
