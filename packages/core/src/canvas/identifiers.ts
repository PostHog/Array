// DI tokens for the canvas/dashboards services. They live in @posthog/core so
// both the host-router routers and the host DI container can reference them
// without depending on the desktop app's main process (where the concrete
// service classes are bound).
export const CANVAS_GEN_SERVICE = Symbol.for("posthog.core.canvas.genService");
export const DASHBOARDS_SERVICE = Symbol.for(
  "posthog.core.canvas.dashboardsService",
);
export const DASHBOARD_QUERY_SERVICE = Symbol.for(
  "posthog.core.canvas.dashboardQueryService",
);
export const CHANNEL_TASKS_SERVICE = Symbol.for(
  "posthog.core.canvas.channelTasksService",
);
