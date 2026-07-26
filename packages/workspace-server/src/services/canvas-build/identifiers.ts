import type { CanvasBuildService } from "./service";

export const CANVAS_BUILD_SERVICE = Symbol.for(
  "posthog.workspace.canvas-build.service",
);

export type ICanvasBuildService = CanvasBuildService;
