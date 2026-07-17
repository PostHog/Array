export const POSTHOG_NOTIFICATIONS = {
  BRANCH_CREATED: "_posthog/branch_created",
  RUN_STARTED: "_posthog/run_started",
  TASK_COMPLETE: "_posthog/task_complete",
  TURN_COMPLETE: "_posthog/turn_complete",
  BACKGROUND_TURN_COMPLETE: "_posthog/background_turn_complete",
  ERROR: "_posthog/error",
  CONSOLE: "_posthog/console",
  SDK_SESSION: "_posthog/sdk_session",
  GIT_CHECKPOINT: "_posthog/git_checkpoint",
  MODE_CHANGE: "_posthog/mode_change",
  SESSION_RESUME: "_posthog/session/resume",
  USER_MESSAGE: "_posthog/user_message",
  CANCEL: "_posthog/cancel",
  CLOSE: "_posthog/close",
  STATUS: "_posthog/status",
  PROGRESS: "_posthog/progress",
  TASK_NOTIFICATION: "_posthog/task_notification",
  COMPACT_BOUNDARY: "_posthog/compact_boundary",
  USAGE_UPDATE: "_posthog/usage_update",
  PERMISSION_RESPONSE: "_posthog/permission_response",
  PERMISSION_REQUEST: "_posthog/permission_request",
  PERMISSION_RESOLVED: "_posthog/permission_resolved",
  WORKFLOW_BUILT: "_posthog/workflow_built",
} as const;

// Qualified id of the agent's `speak` narration tool, as it appears on the
// surfaced tool_call (`_meta.claudeCode.toolName`). Mirrors the agent's
// LOCAL_TOOLS_MCP_NAME + tool name; kept here so core doesn't import @posthog/agent.
export const SPEAK_TOOL_QUALIFIED_NAME = "mcp__posthog-code-tools__speak";

type PosthogNotification =
  (typeof POSTHOG_NOTIFICATIONS)[keyof typeof POSTHOG_NOTIFICATIONS];

function matchesExt(method: string | undefined, expected: string): boolean {
  if (!method) return false;
  return method === expected || method === `_${expected}`;
}

export function isNotification(
  method: string | undefined,
  expected: PosthogNotification,
): boolean {
  return matchesExt(method, expected);
}

// The PostHog workflow a build attached to its canvas (payload of a
// `_posthog/workflow_built` notification). Mirrors WorkflowBuiltPayload in
// @posthog/agent; duplicated here so core/ui parse it without importing agent.
export interface WorkflowBuiltPayload {
  dashboardId: string;
  workflowId: string;
  workflowStatus?: string;
  workflowName?: string;
  workflowType?: string;
}

// Parse a `_posthog/workflow_built` notification's params, returning the link
// payload only when the required ids are present. Tolerates the loosely-typed
// JSON-RPC params object that arrives off the session stream.
export function parseWorkflowBuiltParams(
  params: unknown,
): WorkflowBuiltPayload | null {
  if (!params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  if (typeof p.dashboardId !== "string" || typeof p.workflowId !== "string") {
    return null;
  }
  return {
    dashboardId: p.dashboardId,
    workflowId: p.workflowId,
    workflowStatus:
      typeof p.workflowStatus === "string" ? p.workflowStatus : undefined,
    workflowName:
      typeof p.workflowName === "string" ? p.workflowName : undefined,
    workflowType:
      typeof p.workflowType === "string" ? p.workflowType : undefined,
  };
}
