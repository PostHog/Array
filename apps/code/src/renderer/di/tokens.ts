/**
 * Renderer process DI tokens.
 *
 * IMPORTANT: These tokens are for renderer process only.
 * Never import this file from main code.
 */
export const RENDERER_TOKENS = Object.freeze({
  // Infrastructure
  TRPCClient: Symbol.for("Renderer.TRPCClient"),

  // Services
  TaskService: Symbol.for("Renderer.TaskService"),
  SetupRunService: Symbol.for("Renderer.SetupRunService"),
});
