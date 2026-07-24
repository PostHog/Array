import type { PiRunner } from "@posthog/core/pi-runtime/piRunner";

// There is no local pi runtime in a browser. TASK_SERVICE injects PI_RUNNER and
// resolves eagerly at the task views, but the runner only fires for local
// `runtime === "pi"` tasks — web is cloud-only (no local workspaces), so cloud
// tasks never reach these methods. This stub exists so the eager DI resolution
// succeeds; its methods reject since no local pi session can exist on web.
const notSupported = () =>
  Promise.reject(new Error("Local pi tasks are not available on the web"));

export const webPiRunner: PiRunner = {
  create: notSupported,
  resume: notSupported,
  stop: notSupported,
};
