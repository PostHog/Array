import type {
  LoopBehaviors,
  LoopConnectors,
  LoopNotificationChannel,
  LoopNotifications,
} from "../types";

export function createDefaultNotificationChannel(): LoopNotificationChannel {
  return {
    enabled: false,
    events: ["run_failed", "needs_attention"],
    params: {},
  };
}

export function createDefaultNotifications(): LoopNotifications {
  return {
    push: createDefaultNotificationChannel(),
    email: createDefaultNotificationChannel(),
    slack: createDefaultNotificationChannel(),
  };
}

export function createDefaultBehaviors(): LoopBehaviors {
  return {
    create_prs: false,
    watch_ci: false,
    fix_review_comments: false,
    max_fix_iterations: 3,
  };
}

export function createDefaultConnectors(): LoopConnectors {
  return {
    mcp_installation_ids: [],
    posthog_mcp_scopes: "read_only",
  };
}
