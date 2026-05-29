/**
 * Renderer process DI tokens.
 *
 * IMPORTANT: These tokens are for renderer process only.
 * Never import this file from main code.
 */
export const RENDERER_TOKENS = Object.freeze({
  // Infrastructure
  TRPCClient: Symbol.for("posthog.host.renderer.trpc-client"),

  // Services
  TaskService: Symbol.for("posthog.host.renderer.task-service"),
});
